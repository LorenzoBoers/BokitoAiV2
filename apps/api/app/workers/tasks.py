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
from app.services.agent.loop import AgentLoop
from app.services.agent.tools import execute_tool

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
            select(Agent).where(Agent.tenant_id == UUID(tenant_id), Agent.role == "orchestra").limit(1)
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


class WorkerSettings:
    functions = [process_inbound_email, process_change_request, orchestra_tick, coding_agent_run]
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
