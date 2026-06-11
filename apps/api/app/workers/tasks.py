import json
from datetime import datetime
from uuid import UUID

from arq import create_pool
from arq.connections import RedisSettings
from sqlalchemy import select

from app.config import get_settings
from app.db.session import async_session_factory, init_db
from app.models.agent import Agent, AgentRun, RunEvent
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.agent.loop import AgentLoop
from app.services.orchestration.runner import run_agent_task_segment, start_workstream_as_task

settings = get_settings()


async def startup(ctx):
    await init_db()


async def process_inbound_signal(ctx, tenant_id: str, signal_id: str):
    """Run the assistant loop on a new inbound signal (email, webhook, ...)."""
    async with async_session_factory() as session:
        signal_result = await session.execute(
            select(Signal).where(Signal.id == UUID(signal_id))
        )
        signal = signal_result.scalar_one_or_none()
        if not signal:
            return {"skipped": True}

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
        prompt = (
            f"New inbound {signal.channel} message from {msg.from_address or signal.contact_email}\n"
            f"Subject: {signal.subject}\n\n{msg.body_text}\n\n"
            "Decide: reply, operational action via tool/MCP, or escalate. "
            "Use create_decision_request with multiple choice options."
        )
        await loop.run_chat([{"role": "user", "content": prompt}])
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=UUID(tenant_id),
                event_type="agent_processed",
                actor_type="agent",
                actor_id=str(agent.id),
                payload_json=json.dumps({"run_id": str(run.id)}),
            )
        )
        await session.commit()
        return {"processed": True, "signal_id": signal_id}


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


async def process_due_triggers_job(ctx):
    from app.services.triggers import process_due_triggers

    async with async_session_factory() as session:
        count = await process_due_triggers(session)
        return {"triggers_fired": count}


class WorkerSettings:
    functions = [
        process_inbound_signal,
        coding_agent_run,
        run_agent_task_segment_job,
        run_workstream_orchestrated,
        process_due_triggers_job,
    ]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(settings.redis_url)


async def enqueue_signal_processing(tenant_id: str, signal_id: str):
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("process_inbound_signal", tenant_id, signal_id)
    except Exception:
        # Worker unavailable (local dev without Redis); message remains for later sync.
        return

