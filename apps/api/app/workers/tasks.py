import json
import os
from datetime import datetime
from uuid import UUID

from arq import create_pool, cron
from arq.connections import RedisSettings
from sqlalchemy import select

from app.config import get_settings
from app.db.session import async_session_factory, init_db
from app.models.agent import Agent, AgentRun, RunEvent
from app.models.channel import ChannelAccount
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.agent.loop import AgentLoop
from app.services.orchestration.runner import run_agent_task_segment, start_workstream_as_task

settings = get_settings()

# Suggest mode is research-only: the agent may read the knowledge base and
# query connected MCP integrations, and raise inline decisions — but it can
# never send, write, or mutate anything.
SUGGEST_MODE_TOOLS = frozenset(
    {
        "search_index",
        "list_docs",
        "read_doc",
        "get_tenant_overview",
        "call_mcp_tool",
        "create_decision_request",
    }
)


async def startup(ctx):
    await init_db()


async def process_inbound_signal(ctx, tenant_id: str, signal_id: str):
    """Run the assistant loop on a new inbound signal (email, widget, webhook, ...)."""
    from app.models.auth import Tenant
    from app.services.channel_ai import resolve_ai_mode

    async with async_session_factory() as session:
        signal_result = await session.execute(
            select(Signal).where(
                Signal.id == UUID(signal_id), Signal.tenant_id == UUID(tenant_id)
            )
        )
        signal = signal_result.scalar_one_or_none()
        if not signal:
            return {"skipped": True}

        if signal.ai_paused:
            return {"skipped": True, "reason": "ai_paused"}

        account: ChannelAccount | None = None
        if signal.channel_account_id:
            account = await session.get(ChannelAccount, signal.channel_account_id)
        tenant = await session.get(Tenant, UUID(tenant_id))
        ai_mode = resolve_ai_mode(tenant, account, signal.channel)
        if ai_mode == "off":
            return {"skipped": True, "reason": "ai_mode_off"}

        msg_result = await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == signal.id, SignalMessage.direction == "inbound")
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
        msg = msg_result.scalar_one_or_none()
        if not msg:
            return {"skipped": True, "reason": "no inbound message"}

        from app.services.routing import resolve_agent_for_signal

        # Automated / no-reply mail (system notifications, newsletters, bounces):
        # never draft a reply. Surface a compact action suggestion instead —
        # close the thread, create a task, or keep it open.
        from app.services.automated_mail import classify_automated_email

        try:
            msg_meta = json.loads(msg.metadata_json or "{}")
        except json.JSONDecodeError:
            msg_meta = {}
        classification = classify_automated_email(
            msg.from_address or signal.contact_email or "",
            headers=msg_meta.get("auto_headers") if isinstance(msg_meta, dict) else None,
        )
        if classification["automated"]:
            from app.services.inbound_agent import create_action_suggestion

            agent = await resolve_agent_for_signal(session, signal)
            preview = (msg.body_preview or msg.body_text or "").strip()[:280]
            delivery = await create_action_suggestion(
                session,
                UUID(tenant_id),
                signal,
                agent,
                summary=preview or "Automated notification; no reply needed.",
                reason=classification["reason"],
            )
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=UUID(tenant_id),
                    event_type="agent_processed",
                    actor_type="system",
                    actor_id="",
                    payload_json=json.dumps(
                        {"delivery": delivery, "automated_mail": classification["reason"]}
                    ),
                )
            )
            await session.commit()
            return {"processed": True, "signal_id": signal_id, "delivery": delivery}

        agent = await resolve_agent_for_signal(session, signal)
        if not agent:
            return {"skipped": True, "reason": "no agent"}

        run = AgentRun(
            tenant_id=UUID(tenant_id),
            agent_id=agent.id,
            trigger_type=signal.channel,
            trigger_id=signal_id,
            subject=f"{signal.channel.title()}: {signal.subject[:80]}",
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)

        loop = AgentLoop(
            session, UUID(tenant_id), None, agent=agent, run=run, signal_id=signal.id
        )
        if ai_mode == "suggest":
            # Suggest-only: read-only research tools + inline decisions.
            # The final reply text becomes a DecisionRequest via
            # create_reply_suggestion — the agent can never send directly.
            loop.tools = [t for t in loop.tools if t["name"] in SUGGEST_MODE_TOOLS]
            prompt = (
                f"New inbound {signal.channel} message from {msg.from_address or signal.contact_email}\n"
                f"Subject: {signal.subject}\n\n{msg.body_text}\n\n"
                "You are preparing a response for a human teammate to review; "
                "nothing you produce is sent automatically.\n"
                "1. Research first: use search_index / read_doc for workspace knowledge, "
                "and call_mcp_tool to query connected business systems (accounting, CRM) "
                "when the question concerns records that live there.\n"
                "2. Then do exactly one of the following:\n"
                "   - Return the proposed reply body text (it becomes a suggestion card "
                "the human can approve, edit, or escalate), or\n"
                "   - When the human must choose between concrete alternatives, call "
                "create_decision_request with clear multiple-choice options "
                "(add an option with input_type \"text\" when a free-text answer is useful), "
                "then return exactly: Done.\n"
                "   - If the message is an automated notification that needs no reply "
                "(no-reply sender, newsletter, receipt, system alert), return exactly: "
                "NO_REPLY_NEEDED: <one-line summary of what it says>.\n"
                "Never invent facts about the customer's administration — if research "
                "returns nothing, say so in the draft and propose next steps."
            )
        else:
            prompt = (
                f"New inbound {signal.channel} message from {msg.from_address or signal.contact_email}\n"
                f"Subject: {signal.subject}\n\n{msg.body_text}\n\n"
                "Reply directly to the customer; your final message is delivered as-is. "
                "Use tools for operational actions, or create_decision_request "
                "with multiple choice options when human input is required. "
                "If the message is an automated notification that needs no reply "
                "(no-reply sender, newsletter, receipt, system alert), do not reply; "
                "return exactly: NO_REPLY_NEEDED: <one-line summary of what it says>."
            )
        reply_text, tokens = await loop.run_chat([{"role": "user", "content": prompt}])

        # If the agent already raised its own inline decision card during the
        # run, don't stack an automatic reply-suggestion card on top of it.
        agent_created_decision = any(
            step.get("step_type") == "tool_call" and step.get("name") == "create_decision_request"
            for step in loop.trace_steps
        )

        from app.services.automated_mail import extract_no_reply_summary
        from app.services.inbound_agent import create_action_suggestion, persist_inbound_agent_reply

        no_reply_summary = extract_no_reply_summary(reply_text)
        if no_reply_summary is not None:
            # The model judged this an automated notification: suggest an
            # action (close / task / keep open) instead of sending a reply.
            delivery = await create_action_suggestion(
                session,
                UUID(tenant_id),
                signal,
                agent,
                summary=no_reply_summary,
                reason="agent_judgement",
                run_id=run.id,
            )
        elif ai_mode == "suggest" and agent_created_decision:
            delivery = {"decision_created": True, "delivery": "pending_decision"}
        else:
            delivery = await persist_inbound_agent_reply(
                session,
                UUID(tenant_id),
                signal,
                agent,
                reply_text=reply_text,
                run_id=run.id,
                tokens=tokens,
                mode=ai_mode,
            )

        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=UUID(tenant_id),
                event_type="agent_processed",
                actor_type="agent",
                actor_id=str(agent.id),
                payload_json=json.dumps({"run_id": str(run.id), "delivery": delivery}),
            )
        )
        await session.commit()
        return {"processed": True, "signal_id": signal_id, "delivery": delivery}


async def coding_agent_run(ctx, tenant_id: str, task_subject: str, repo_path: str = "/work"):
    """V2 skeleton: coding agent run with sandbox placeholder."""
    async with async_session_factory() as session:
        agent_result = await session.execute(
            select(Agent).where(Agent.tenant_id == UUID(tenant_id), Agent.role == "coding").limit(1)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            return {"skipped": True}

        run = AgentRun(
            tenant_id=UUID(tenant_id),
            agent_id=agent.id,
            trigger_type="coding",
            subject=task_subject,
            result_json=json.dumps({"repo_path": repo_path, "status": "sandbox_pending"}),
        )
        session.add(run)
        await session.commit()
        event = RunEvent(
            run_id=run.id,
            tenant_id=UUID(tenant_id),
            event_type="sandbox",
            message=f"Coding run queued for repo at {repo_path} (V2 sandbox runner)",
        )
        session.add(event)
        run.status = "completed"
        run.completed_at = datetime.utcnow()
        await session.commit()
        return {"coding_run": str(run.id)}


async def run_workstream_orchestrated(ctx, tenant_id: str, workstream_id: str, trigger_type: str = "manual"):
    async with async_session_factory() as session:
        task = await start_workstream_as_task(
            session, UUID(tenant_id), UUID(workstream_id), trigger_type=trigger_type
        )
        max_segments = 20
        for _ in range(max_segments):
            result = await run_agent_task_segment(session, UUID(tenant_id), task.id)
            if result.get("completed") or result.get("failed") or result.get("paused"):
                break
            await session.refresh(task)
            if task.status in ("completed", "failed", "cancelled", "awaiting_decision"):
                break
        return {"task_id": str(task.id), "status": task.status}


async def run_agent_task_segment_job(ctx, tenant_id: str, task_id: str):
    async with async_session_factory() as session:
        return await run_agent_task_segment(session, UUID(tenant_id), UUID(task_id))


async def sync_email_mailboxes_job(ctx):
    """Poll all enabled Outlook/Gmail mailboxes and ingest new messages."""
    from app.services.email_sync import sync_account

    if os.environ.get("EMAIL_SYNC_ENABLED", "true").lower() in ("0", "false", "no", "off"):
        return {"skipped": True, "reason": "disabled"}

    async with async_session_factory() as session:
        result = await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.channel == "email",
                ChannelAccount.is_enabled.is_(True),
                ChannelAccount.provider.in_(("gmail", "outlook")),
            )
        )
        accounts = list(result.scalars().all())
        synced = []
        for account in accounts:
            try:
                info = await sync_account(session, account)
                synced.append(info)
            except Exception as exc:  # noqa: BLE001 — isolate per-account failures
                synced.append(
                    {
                        "account_id": str(account.id),
                        "synced": 0,
                        "status": f"error:{exc}",
                    }
                )
        return {"accounts": len(accounts), "results": synced}


class WorkerSettings:
    # Triggers + learning are scheduled by the in-process API scheduler
    # (app.services.trigger_scheduler); the worker only handles queued jobs
    # and mailbox polling.
    functions = [
        process_inbound_signal,
        coding_agent_run,
        run_agent_task_segment_job,
        run_workstream_orchestrated,
        sync_email_mailboxes_job,
    ]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    # Poll mailboxes every minute (replaces the former in-process API scheduler poll).
    cron_jobs = [cron(sync_email_mailboxes_job, second=0)]


async def enqueue_signal_processing(tenant_id: str, signal_id: str):
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("process_inbound_signal", tenant_id, signal_id)
    except Exception as exc:  # noqa: BLE001
        # Worker unavailable (local dev without Redis): fall back to in-process
        # processing so inbound AI flows still work without infrastructure.
        import asyncio
        import logging

        from app.services.runtime_health import record_redis_enqueue_failure

        logging.getLogger(__name__).warning(
            "Redis unavailable, processing inbound signal %s in-process: %s",
            signal_id,
            exc,
        )
        record_redis_enqueue_failure(f"inbound_signal: {exc}")

        async def _inline() -> None:
            try:
                await process_inbound_signal(None, tenant_id, signal_id)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception(
                    "In-process signal processing failed for %s", signal_id
                )

        asyncio.create_task(_inline())
        return
