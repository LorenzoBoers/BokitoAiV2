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
# never send, write, or mutate anything. create_queue_item is the one
# exception: under "ask" policy it renders an inline proposal card, so
# conversations can still feed project queues in suggest mode.
SUGGEST_MODE_TOOLS = frozenset(
    {
        "search_index",
        "search_product_help",
        "list_docs",
        "read_doc",
        "get_tenant_overview",
        "call_mcp_tool",
        "create_decision_request",
        "list_projects",
        "list_queue_items",
        "list_project_docs",
        "create_queue_item",
    }
)


async def startup(ctx):
    from app.observability import init_observability

    init_observability("worker")
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
        if signal.channel == "email" and account is None:
            # Mailbox disconnected: suggesting or sending replies that can
            # never be delivered would be misleading.
            return {"skipped": True, "reason": "mailbox_disconnected"}
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

        try:
            msg_meta = json.loads(msg.metadata_json or "{}")
        except json.JSONDecodeError:
            msg_meta = {}
        auto_headers = msg_meta.get("auto_headers") if isinstance(msg_meta, dict) else None
        sender_address = msg.from_address or signal.contact_email or ""

        # Learned inbox rules first: when the tenant already decided what to do
        # with this sender (auto-close, auto-task, skip AI) the rule handles the
        # thread directly — no agent run, no decision card.
        from app.services import inbox_rules

        rule = await inbox_rules.find_matching_rule(
            session, UUID(tenant_id), sender_address, headers=auto_headers
        )
        if rule:
            outcome = await inbox_rules.apply_rule_to_signal(
                session, UUID(tenant_id), signal, msg, rule
            )
            return {"processed": True, "signal_id": signal_id, "delivery": outcome}

        # Inbound from a workspace member (teammate wrote into a shared inbox):
        # never draft a customer reply to an operator.
        from app.services.workspace_members import find_member_by_email

        if msg.author_user_id or await find_member_by_email(
            session, UUID(tenant_id), sender_address
        ):
            return {"skipped": True, "reason": "workspace_member"}

        # Automated / no-reply mail (system notifications, newsletters, bounces):
        # never draft a reply. Surface a compact action suggestion instead —
        # close the thread, create a task, or keep it open.
        from app.services.automated_mail import classify_automated_email, clip_with_ellipsis

        classification = classify_automated_email(sender_address, headers=auto_headers)
        if classification["automated"]:
            from app.services.inbound_agent import create_action_suggestion

            agent = await resolve_agent_for_signal(session, signal)
            preview = clip_with_ellipsis(msg.body_preview or msg.body_text or "")
            delivery = await create_action_suggestion(
                session,
                UUID(tenant_id),
                signal,
                agent,
                summary=preview or signal.subject or "Automated notification; no reply needed.",
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
            project_id=signal.project_id,
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

        # Language policy: reply drafts mirror the customer's language (or a
        # pinned mailbox/tenant language); team-facing summaries follow the
        # workspace language. See services/language.py.
        from app.services.language import (
            reply_language_instruction,
            resolve_reply_language,
            resolve_workspace_language,
            workspace_language_instruction,
        )

        language_rules = (
            "Language rules:\n"
            f"- {reply_language_instruction(resolve_reply_language(tenant, account))}\n"
            f"- {workspace_language_instruction(resolve_workspace_language(tenant))}\n"
        )

        # Full message text: body_text can be a provider snippet for HTML-only
        # mail; message_plain_text falls back to the HTML-derived text.
        from app.services.signals import message_plain_text

        msg_text = message_plain_text(msg)

        # Conversation-driven projects: give the agent the project landscape so
        # it can recognize opportunities/bugs and feed the right project queue.
        project_context = ""
        try:
            from app.services.project_work import conversation_project_context

            snippet = await conversation_project_context(session, UUID(tenant_id), signal)
            if snippet:
                project_context = f"{snippet}\n"
        except Exception:  # noqa: BLE001 — context enrichment must never block replies
            project_context = ""

        if ai_mode == "suggest":
            # Suggest-only: read-only research tools + inline decisions.
            # The final reply text becomes a DecisionRequest via
            # create_reply_suggestion — the agent can never send directly.
            loop.tools = [t for t in loop.tools if t["name"] in SUGGEST_MODE_TOOLS]
            prompt = (
                f"New inbound {signal.channel} message from {msg.from_address or signal.contact_email}\n"
                f"Subject: {signal.subject}\n\n{msg_text}\n\n"
                "You are preparing a response for a human teammate to review; "
                "nothing you produce is sent automatically.\n"
                "1. Research first: use search_index / read_doc for workspace knowledge, "
                "search_product_help for how Bokito itself works, "
                "and call_mcp_tool to query connected business systems (accounting, CRM) "
                "when the question concerns records that live there.\n"
                "2. Then do exactly one of the following:\n"
                "   - Return the proposed reply body text (it becomes a suggestion card "
                "the human can approve, edit, or escalate). The reply body must contain "
                "ONLY the customer-facing text: start with the greeting (Hallo/Hoi/Hi), "
                "no research preamble, no meta commentary about stubs or missing docs, "
                "no notes about platform help, no dividers. Do NOT write a "
                "sign-off or signature (no 'Met vriendelijke groet', no name) — the "
                "system appends the sender's signature automatically. Anything meant "
                "for your teammates (context, caveats, research notes) goes AFTER the "
                "body on a new line starting with exactly: INTERNAL_NOTE: . "
                "For customer email, never use relative /docs or /learn paths and never "
                "leave markdown links like [label](/docs/...); write a full "
                "https://app.bokito.ai/... URL as plain text so the customer can click it, or\n"
                "   - When the human must choose between concrete alternatives, call "
                "create_decision_request with clear multiple-choice options "
                "(add an option with input_type \"text\" when a free-text answer is useful). "
                "Give every option a distinct id and a distinct human-readable label. "
                "Set each option's action_type to a real tool name only when approving "
                "should run that tool. If an option should send a customer reply "
                "(e.g. ask for clarification), use action_type \"send_reply\" with "
                "payload.body_text set to that draft — do not use escalate for options "
                "that send mail. Use escalate or acknowledge only for pure human "
                "takeover (pause AI, no outbound). Then return exactly: Done.\n"
                "   - If the message is an automated notification that needs no reply "
                "(no-reply sender, newsletter, receipt, system alert), return exactly: "
                "NO_REPLY_NEEDED: <one-line summary of what it says>.\n"
                f"{language_rules}"
                f"{project_context}"
                "Never invent facts about the customer's administration — if research "
                "returns nothing, say so in the draft and propose next steps."
            )
        else:
            prompt = (
                f"New inbound {signal.channel} message from {msg.from_address or signal.contact_email}\n"
                f"Subject: {signal.subject}\n\n{msg_text}\n\n"
                "Reply directly to the customer; your final message is delivered as-is. "
                "Use tools for operational actions, or create_decision_request "
                "with multiple choice options when human input is required. "
                "If the message is an automated notification that needs no reply "
                "(no-reply sender, newsletter, receipt, system alert), do not reply; "
                "return exactly: NO_REPLY_NEEDED: <one-line summary of what it says>.\n"
                f"{language_rules}"
                f"{project_context}"
            )
        try:
            reply_text, tokens = await loop.run_chat([{"role": "user", "content": prompt}])
        except Exception as exc:
            # Never leave the run stuck on "running": the agenda, cockpit and
            # workforce views all read this status.
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            session.add(run)
            await session.commit()

            from app.services.ops_alerts import alert_run_failure

            await alert_run_failure(
                session,
                UUID(tenant_id),
                subject=run.subject or signal.subject or signal.channel,
                error=exc,
                run_id=run.id,
                signal_id=signal.id,
            )
            raise

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

        run.status = "completed"
        run.completed_at = datetime.utcnow()
        if isinstance(tokens, dict):
            run.tokens_input = int(tokens.get("input_tokens") or 0)
            run.tokens_output = int(tokens.get("output_tokens") or 0)
        session.add(run)
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

        # Interpretation pass after the reply loop: category, urgency, intent
        # (implementation_request / bug_report feed the queue chips). Failures
        # are non-fatal — the reply already went out.
        try:
            from app.services.interpretation import triage_signal

            await triage_signal(session, UUID(tenant_id), signal.id)
        except Exception:  # noqa: BLE001
            import logging

            logging.getLogger(__name__).warning(
                "Triage failed for signal %s", signal_id, exc_info=True
            )

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


async def send_tenant_digests_job(ctx):
    """Daily digest mails at 06:00 UTC; weekly digests fire on Mondays."""
    from app.services.digest_mail import send_tenant_digests

    async with async_session_factory() as session:
        daily = await send_tenant_digests(session, period="daily")
        weekly = 0
        if datetime.utcnow().weekday() == 0:
            weekly = await send_tenant_digests(session, period="weekly")
    return {"daily": daily, "weekly": weekly}


async def snapshot_platform_metrics_job(ctx):
    """Daily snapshot points for platform-sourced custom metrics."""
    from app.services.metrics import snapshot_platform_metrics

    async with async_session_factory() as session:
        written = await snapshot_platform_metrics(session)
    return {"points": written}


async def index_project_repo_job(ctx, tenant_id: str, project_id: str):
    """Index a project's connected GitHub repo into the vector pipeline."""
    from app.services.repo_index import index_project_repo

    async with async_session_factory() as session:
        return await index_project_repo(session, UUID(tenant_id), UUID(project_id))


async def deliver_webhook_job(ctx, delivery_id: str):
    """Deliver one outbound webhook (HMAC-signed, with in-task retries)."""
    from app.models.webhook import WebhookDelivery
    from app.services.webhooks import perform_delivery

    async with async_session_factory() as session:
        result = await session.execute(
            select(WebhookDelivery).where(WebhookDelivery.id == UUID(delivery_id))
        )
        delivery = result.scalar_one_or_none()
        if not delivery or delivery.status != "pending":
            return {"skipped": True}
        delivery = await perform_delivery(session, delivery)
        return {"status": delivery.status, "status_code": delivery.status_code}


async def index_module_source_job(ctx, source_id: str):
    """Fetch and index one ModuleSource URL into workspace docs."""
    from app.services.module_sources import index_source

    async with async_session_factory() as session:
        row = await index_source(session, UUID(source_id))
        return {"id": str(row.id), "status": row.status}


async def reindex_module_sources_job(ctx):
    """Weekly cron: reindex platform + auto_reindex tenant module sources."""
    from app.services.module_sources import reindex_due_sources

    async with async_session_factory() as session:
        count = await reindex_due_sources(session)
        return {"reindexed": count}


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
        deliver_webhook_job,
        index_project_repo_job,
        index_module_source_job,
        reindex_module_sources_job,
    ]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    # Poll mailboxes every minute (replaces the former in-process API scheduler poll).
    cron_jobs = [
        cron(sync_email_mailboxes_job, second=0),
        cron(send_tenant_digests_job, hour=6, minute=0),
        cron(snapshot_platform_metrics_job, hour=5, minute=30),
        cron(reindex_module_sources_job, weekday=0, hour=3, minute=15),
    ]


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


async def enqueue_repo_index(tenant_id: str, project_id: str):
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("index_project_repo_job", tenant_id, project_id)
    except Exception as exc:  # noqa: BLE001
        # No Redis (local dev): index in-process so the flow still works.
        import asyncio
        import logging

        from app.services.runtime_health import record_redis_enqueue_failure

        logging.getLogger(__name__).warning(
            "Redis unavailable, indexing repo for project %s in-process: %s", project_id, exc
        )
        record_redis_enqueue_failure(f"repo_index: {exc}")

        async def _inline() -> None:
            try:
                await index_project_repo_job(None, tenant_id, project_id)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception(
                    "In-process repo indexing failed for project %s", project_id
                )

        asyncio.create_task(_inline())
        return


async def enqueue_webhook_delivery(delivery_id: str):
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("deliver_webhook_job", delivery_id)
    except Exception as exc:  # noqa: BLE001
        # No Redis (local dev): deliver in-process so webhooks still fire.
        import asyncio
        import logging

        from app.services.runtime_health import record_redis_enqueue_failure

        logging.getLogger(__name__).warning(
            "Redis unavailable, delivering webhook %s in-process: %s", delivery_id, exc
        )
        record_redis_enqueue_failure(f"webhook_delivery: {exc}")

        async def _inline() -> None:
            try:
                await deliver_webhook_job(None, delivery_id)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception(
                    "In-process webhook delivery failed for %s", delivery_id
                )

        asyncio.create_task(_inline())
        return


async def enqueue_module_source_index(source_id: str):
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("index_module_source_job", source_id)
    except Exception as exc:  # noqa: BLE001
        import asyncio
        import logging

        from app.services.runtime_health import record_redis_enqueue_failure

        logging.getLogger(__name__).warning(
            "Redis unavailable, indexing module source %s in-process: %s", source_id, exc
        )
        record_redis_enqueue_failure(f"module_source_index: {exc}")

        async def _inline() -> None:
            try:
                await index_module_source_job(None, source_id)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception(
                    "In-process module source indexing failed for %s", source_id
                )

        asyncio.create_task(_inline())
        return
