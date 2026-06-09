import json
from datetime import datetime
from uuid import UUID

from arq import create_pool
from arq.connections import RedisSettings
from sqlalchemy import select

from app.config import get_settings
from app.db.session import async_session_factory, init_db
from app.models.agent import Agent, AgentRun, RunEvent
from app.models.blueprint import BlueprintChangeRequest
from app.models.email import EmailMessage
from app.services.orchestration.dispatcher import create_agent_task, trigger_automation_task
from app.services.orchestration.queue import enqueue_agent_task_segment
from app.services.agent.loop import AgentLoop
from app.services.orchestration.runner import run_agent_task_segment, start_workstream_as_task

settings = get_settings()


async def startup(ctx):
    await init_db()


async def process_inbound_email(ctx, tenant_id: str, message_id: str):
    async with async_session_factory() as session:
        msg_result = await session.execute(
            select(EmailMessage).where(EmailMessage.id == UUID(message_id))
        )
        msg = msg_result.scalar_one_or_none()
        if not msg or msg.processed_by_agent:
            return {"skipped": True}

        agent_result = await session.execute(
            select(Agent).where(Agent.tenant_id == UUID(tenant_id), Agent.role == "assistant").limit(1)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            msg.processed_by_agent = True
            await session.commit()
            return {"skipped": True, "reason": "no agent"}

        run = AgentRun(
            tenant_id=UUID(tenant_id),
            agent_id=agent.id,
            trigger_type="email",
            trigger_id=message_id,
            subject=f"Email: {msg.subject[:80]}",
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)

        loop = AgentLoop(session, UUID(tenant_id), None, agent=agent, run=run)
        prompt = (
            f"New inbound email from {msg.from_address}\n"
            f"Subject: {msg.subject}\n\n{msg.body_text}\n\n"
            "Decide: reply, operational action via tool/MCP, or escalate. "
            "Use create_decision_request with multiple choice options."
        )
        await loop.run_chat([{"role": "user", "content": prompt}])
        msg.processed_by_agent = True
        await session.commit()
        return {"processed": True, "message_id": message_id}


async def process_change_request(ctx, tenant_id: str, change_request_id: str):
    async with async_session_factory() as session:
        cr_result = await session.execute(
            select(BlueprintChangeRequest).where(BlueprintChangeRequest.id == UUID(change_request_id))
        )
        cr = cr_result.scalar_one_or_none()
        if not cr:
            return {"skipped": True}

        agent_result = await session.execute(
            select(Agent).where(Agent.tenant_id == UUID(tenant_id), Agent.role == "po").limit(1)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            agent_result = await session.execute(
                select(Agent).where(Agent.tenant_id == UUID(tenant_id), Agent.role == "assistant").limit(1)
            )
            agent = agent_result.scalar_one_or_none()

        if not agent:
            cr.status = "done"
            await session.commit()
            return {"skipped": True, "reason": "no agent"}

        run = AgentRun(
            tenant_id=UUID(tenant_id),
            agent_id=agent.id,
            trigger_type="change_request",
            trigger_id=change_request_id,
            subject=cr.title,
        )
        session.add(run)
        cr.status = "in_progress"
        await session.commit()
        await session.refresh(run)

        loop = AgentLoop(session, UUID(tenant_id), None, agent=agent, run=run)
        await loop.run_chat(
            [{"role": "user", "content": f"Change request: {cr.title}\n\n{cr.body}\n\nReview blueprint and respond."}]
        )
        cr.status = "done"
        await session.commit()
        return {"processed": True}


async def orchestra_tick(ctx, tenant_id: str):
    """V2 skeleton: periodic proactive scan for improvements and integration suggestions."""
    async with async_session_factory() as session:
        agent_result = await session.execute(
            select(Agent).where(
                Agent.tenant_id == UUID(tenant_id),
                Agent.role.in_(("orchestra", "orchestrator")),
            ).limit(1)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            return {"skipped": True, "reason": "no orchestra agent"}

        run = AgentRun(
            tenant_id=UUID(tenant_id),
            agent_id=agent.id,
            trigger_type="orchestra",
            subject="Orchestra heartbeat",
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)

        loop = AgentLoop(session, UUID(tenant_id), None, agent=agent, run=run)
        await loop.run_chat(
            [
                {
                    "role": "user",
                    "content": "Scan tenant blueprint and suggest improvements or missing integrations.",
                }
            ]
        )
        run.status = "completed"
        run.completed_at = datetime.utcnow()
        await session.commit()
        return {"orchestra": True}


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


async def process_due_automations(ctx):
    from app.models.orchestra import Task as AutomationTask

    async with async_session_factory() as session:
        now = datetime.utcnow()
        result = await session.execute(
            select(AutomationTask).where(
                AutomationTask.enabled.is_(True),
                AutomationTask.schedule_kind.in_(("interval", "cron")),
                AutomationTask.next_run_at <= now,
            )
        )
        count = 0
        for auto in result.scalars().all():
            await trigger_automation_task(session, auto.id, auto.tenant_id)
            if auto.schedule_kind == "interval":
                try:
                    minutes = int(auto.schedule_expr or "60")
                except ValueError:
                    minutes = 60
                from datetime import timedelta

                auto.next_run_at = now + timedelta(minutes=minutes)
            session.add(auto)
            count += 1
        await session.commit()
        return {"automations_run": count}


class WorkerSettings:
    functions = [
        process_inbound_email,
        process_change_request,
        orchestra_tick,
        coding_agent_run,
        run_agent_task_segment_job,
        run_workstream_orchestrated,
        process_due_automations,
    ]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(settings.redis_url)


async def enqueue_email_processing(tenant_id: str, message_id: str):
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("process_inbound_email", tenant_id, message_id)
    except Exception:
        # Worker unavailable (local dev without Redis); message remains for later sync.
        return


async def enqueue_change_request_run(tenant_id: str, change_request_id: str):
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("process_change_request", tenant_id, change_request_id)
    except Exception:
        return
