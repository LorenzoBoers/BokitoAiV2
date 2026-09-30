"""Job functions. Signature: `async def job(ctx, *args)` as ARQ expects."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from bokito.db import get_session_factory
from bokito.domain.conversation import Conversation, ConversationStatus, Message, SendStatus
from bokito.domain.identity import Tenant
from bokito.domain.work import Agent, Run, RunKind, RunStatus
from bokito.services import work as work_svc

log = logging.getLogger(__name__)


async def run_agent_job(
    ctx: dict[str, Any], conversation_id: str, agent_id: str | None = None
) -> dict:
    """Let the assigned (or default) agent act on a conversation."""
    from bokito.agent.loop import run_agent_on_conversation

    async with get_session_factory()() as session:
        conv = await session.get(Conversation, uuid.UUID(conversation_id))
        if not conv or conv.status == ConversationStatus.closed or conv.handoff:
            return {"skipped": True}
        tenant = await session.get(Tenant, conv.tenant_id)
        agent = None
        if agent_id:
            agent = await session.get(Agent, uuid.UUID(agent_id))
        elif conv.agent_id:
            agent = await session.get(Agent, conv.agent_id)
        if agent is None:
            agent = await work_svc.ensure_default_agent(session, conv.tenant_id)
        if not agent.active:
            return {"skipped": True, "reason": "agent inactive"}
        if conv.agent_id is None:
            conv.agent_id = agent.id
        result = await run_agent_on_conversation(session, tenant, agent, conv)
        await session.commit()
        return {"run_id": str(result.run_id), "status": result.status, "replied": result.replied}


async def handle_inbound_job(ctx: dict[str, Any], conversation_id: str) -> dict:
    """After an inbound message: let an agent respond unless a human owns the thread."""
    async with get_session_factory()() as session:
        conv = await session.get(Conversation, uuid.UUID(conversation_id))
        if not conv:
            return {"skipped": True}
        if conv.handoff or conv.assignee_user_id:
            return {"skipped": True, "reason": "human owns the conversation"}
        if conv.channel.value in ("internal",):
            return {"skipped": True, "reason": "internal"}
    return await run_agent_job(ctx, conversation_id)


async def run_playbook_job(ctx: dict[str, Any], run_id: str) -> dict:
    """Execute playbook steps. Each step is an instruction to the playbook's agent."""
    from bokito.agent.loop import run_agent_on_conversation
    from bokito.services import decision as decision_svc

    async with get_session_factory()() as session:
        run = await session.get(Run, uuid.UUID(run_id))
        if not run or run.status in (RunStatus.done, RunStatus.cancelled, RunStatus.failed):
            return {"skipped": True}
        tenant = await session.get(Tenant, run.tenant_id)
        playbook = (
            await work_svc.get_playbook(session, run.tenant_id, run.playbook_id)
            if run.playbook_id
            else None
        )
        if playbook is None:
            await work_svc.finish_run(
                session, run, status=RunStatus.failed, error="playbook missing"
            )
            await session.commit()
            return {"failed": True}
        agent = (
            await session.get(Agent, playbook.agent_id) if playbook.agent_id else None
        ) or await work_svc.ensure_default_agent(session, run.tenant_id)
        conv = await session.get(Conversation, run.conversation_id) if run.conversation_id else None
        if conv is None:
            conv = await decision_svc.govern_conversation(session, run.tenant_id)
            run.conversation_id = conv.id
        run.status = RunStatus.running
        steps = list(playbook.steps or [])
        start = int(run.step or 0)
        for index in range(start, len(steps)):
            step = steps[index]
            run.step = index + 1
            await work_svc.run_event(
                session, run, "step", {"index": index, "title": step.get("title", "")}
            )
            instruction = str(step.get("instruction") or step.get("title") or "")
            result = await run_agent_on_conversation(
                session,
                tenant,
                agent,
                conv,
                run=run,
                instructions=f"Playbook step {index + 1}: {instruction}",
            )
            if result.status == "waiting":
                await session.commit()
                return {"waiting": True, "decision_id": str(result.decision_id)}
            if result.status == "failed":
                await session.commit()
                return {"failed": True}
        await work_svc.finish_run(session, run, status=RunStatus.done, output={"steps": len(steps)})
        await session.commit()
        return {"done": True}


async def send_message_job(ctx: dict[str, Any], message_id: str) -> dict:
    """Deliver a queued outbound message (retry path for channels)."""
    from bokito.channels.base import deliver
    from bokito.domain.connection import Connection

    async with get_session_factory()() as session:
        msg = await session.get(Message, uuid.UUID(message_id))
        if not msg or msg.send_status not in (SendStatus.queued, SendStatus.failed):
            return {"skipped": True}
        conv = await session.get(Conversation, msg.conversation_id)
        connection = (
            await session.get(Connection, conv.connection_id)
            if conv and conv.connection_id
            else None
        )
        await deliver(session, connection, conv, msg)
        await session.commit()
        return {"send_status": msg.send_status.value}


async def compute_outcomes_job(ctx: dict[str, Any]) -> dict:
    from bokito.services.outcomes import compute_all

    async with get_session_factory()() as session:
        n = await compute_all(session)
        await session.commit()
        return {"computed": n}


async def fire_due_triggers_job(ctx: dict[str, Any]) -> dict:
    from bokito.services import decision as decision_svc
    from bokito.workers.queue import enqueue

    fired = 0
    async with get_session_factory()() as session:
        for trigger in await work_svc.due_triggers(session):
            conv = await decision_svc.govern_conversation(session, trigger.tenant_id)
            run = await work_svc.create_run(
                session,
                trigger.tenant_id,
                kind=RunKind.trigger if not trigger.playbook_id else RunKind.playbook,
                title=trigger.name,
                actor=f"trigger:{trigger.id}",
                trust="system",
                conversation_id=conv.id,
                agent_id=trigger.agent_id,
                playbook_id=trigger.playbook_id,
                trigger_id=trigger.id,
                input={"instructions": trigger.instructions},
            )
            trigger.last_fired_at = run.created_at
            trigger.next_fire_at = work_svc.compute_next_fire(trigger.kind, trigger.spec or {})
            await session.commit()
            if trigger.playbook_id:
                await enqueue("run_playbook_job", str(run.id))
            else:
                await enqueue("run_trigger_agent_job", str(run.id))
            fired += 1
    return {"fired": fired}


async def run_trigger_agent_job(ctx: dict[str, Any], run_id: str) -> dict:
    from bokito.agent.loop import run_agent_on_conversation

    async with get_session_factory()() as session:
        run = await session.get(Run, uuid.UUID(run_id))
        if not run:
            return {"skipped": True}
        tenant = await session.get(Tenant, run.tenant_id)
        agent = (
            await session.get(Agent, run.agent_id) if run.agent_id else None
        ) or await work_svc.ensure_default_agent(session, run.tenant_id)
        conv = await session.get(Conversation, run.conversation_id)
        result = await run_agent_on_conversation(
            session,
            tenant,
            agent,
            conv,
            run=run,
            instructions=str((run.input or {}).get("instructions") or ""),
        )
        await session.commit()
        return {"status": result.status}
