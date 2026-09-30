"""Agents, playbooks, runs and triggers."""

from __future__ import annotations

import secrets
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.identity import Posture
from bokito.domain.work import (
    Agent,
    Playbook,
    Run,
    RunEvent,
    RunKind,
    RunStatus,
    Trigger,
    TriggerKind,
)
from bokito.errors import Conflict, NotFound
from bokito.realtime.broker import publish
from bokito.services.identity import slugify

DEFAULT_AGENT_INSTRUCTIONS = (
    "You are the workspace's first AI colleague. Answer customers on their own channel, "
    "in their language, briefly and concretely. Use the knowledge base before guessing. "
    "When you are not sure or the request is consequential, hand off to a colleague."
)


async def _unique_slug(session: AsyncSession, model, tenant_id: uuid.UUID, base: str) -> str:
    slug = slugify(base) or "item"
    candidate = slug
    n = 2
    while await session.scalar(
        select(model.id).where(model.tenant_id == tenant_id, model.slug == candidate)
    ):
        candidate = f"{slug}-{n}"
        n += 1
    return candidate


# Agents ---------------------------------------------------------------------


async def create_agent(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    name: str,
    role: str = "",
    instructions: str = "",
    model: str = "",
    tools: list[str] | None = None,
    autonomy_cap: Posture | None = None,
    channels: list[str] | None = None,
    language: str = "",
    is_default: bool = False,
) -> Agent:
    agent = Agent(
        tenant_id=tenant_id,
        slug=await _unique_slug(session, Agent, tenant_id, name),
        name=name[:120],
        role=role[:200],
        instructions=instructions,
        model=model,
        tools=tools or [],
        autonomy_cap=autonomy_cap,
        channels=channels or [],
        language=language,
        is_default=is_default,
    )
    session.add(agent)
    await session.flush()
    return agent


async def ensure_default_agent(session: AsyncSession, tenant_id: uuid.UUID) -> Agent:
    agent = await session.scalar(
        select(Agent).where(Agent.tenant_id == tenant_id, Agent.is_default.is_(True))
    )
    if agent:
        return agent
    agent = await session.scalar(
        select(Agent).where(Agent.tenant_id == tenant_id, Agent.active.is_(True)).limit(1)
    )
    if agent:
        return agent
    return await create_agent(
        session,
        tenant_id,
        name="Assistant",
        role="First responder",
        instructions=DEFAULT_AGENT_INSTRUCTIONS,
        is_default=True,
    )


async def get_agent(session: AsyncSession, tenant_id: uuid.UUID, agent_id: uuid.UUID) -> Agent:
    agent = await session.get(Agent, agent_id)
    if not agent or agent.tenant_id != tenant_id:
        raise NotFound("agent not found", code="agent_not_found")
    return agent


async def list_agents(session: AsyncSession, tenant_id: uuid.UUID) -> list[Agent]:
    stmt = (
        select(Agent)
        .where(Agent.tenant_id == tenant_id)
        .order_by(Agent.is_default.desc(), Agent.name)
    )
    return list((await session.scalars(stmt)).all())


def agent_snapshot(agent: Agent) -> dict[str, Any]:
    return {
        "name": agent.name,
        "role": agent.role,
        "instructions": agent.instructions,
        "model": agent.model,
        "tools": list(agent.tools or []),
        "autonomy_cap": agent.autonomy_cap.value if agent.autonomy_cap else None,
        "channels": list(agent.channels or []),
        "language": agent.language,
        "active": agent.active,
        "is_default": agent.is_default,
    }


def apply_agent_patch(agent: Agent, patch: dict[str, Any]) -> None:
    for key in ("name", "role", "instructions", "model", "tools", "channels", "language", "active"):
        if key in patch and patch[key] is not None:
            setattr(agent, key, patch[key])
    if "autonomy_cap" in patch:
        agent.autonomy_cap = Posture(patch["autonomy_cap"]) if patch["autonomy_cap"] else None
    if patch.get("is_default"):
        agent.is_default = True


# Playbooks ------------------------------------------------------------------


async def create_playbook(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    name: str,
    description: str = "",
    steps: list[dict[str, Any]] | None = None,
    agent_id: uuid.UUID | None = None,
    autonomy_cap: Posture | None = None,
    module: str = "",
) -> Playbook:
    pb = Playbook(
        tenant_id=tenant_id,
        slug=await _unique_slug(session, Playbook, tenant_id, name),
        name=name[:160],
        description=description,
        steps=steps or [],
        agent_id=agent_id,
        autonomy_cap=autonomy_cap,
        module=module,
    )
    session.add(pb)
    await session.flush()
    return pb


async def get_playbook(
    session: AsyncSession, tenant_id: uuid.UUID, playbook_id: uuid.UUID
) -> Playbook:
    pb = await session.get(Playbook, playbook_id)
    if not pb or pb.tenant_id != tenant_id:
        raise NotFound("playbook not found", code="playbook_not_found")
    return pb


async def list_playbooks(session: AsyncSession, tenant_id: uuid.UUID) -> list[Playbook]:
    stmt = select(Playbook).where(Playbook.tenant_id == tenant_id).order_by(Playbook.name)
    return list((await session.scalars(stmt)).all())


# Runs -----------------------------------------------------------------------


async def create_run(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    kind: RunKind,
    title: str,
    actor: str,
    trust: str,
    conversation_id: uuid.UUID | None = None,
    agent_id: uuid.UUID | None = None,
    playbook_id: uuid.UUID | None = None,
    trigger_id: uuid.UUID | None = None,
    parent_run_id: uuid.UUID | None = None,
    input: dict[str, Any] | None = None,
) -> Run:
    run = Run(
        tenant_id=tenant_id,
        kind=kind,
        status=RunStatus.queued,
        title=title[:300],
        actor=actor,
        trust=trust,
        conversation_id=conversation_id,
        agent_id=agent_id,
        playbook_id=playbook_id,
        trigger_id=trigger_id,
        parent_run_id=parent_run_id,
        input=input or {},
        created_at=utcnow(),
    )
    session.add(run)
    await session.flush()
    await publish(tenant_id, "runs", {"event": "created", "id": str(run.id), "kind": kind.value})
    return run


async def run_event(
    session: AsyncSession, run: Run, kind: str, payload: dict[str, Any]
) -> RunEvent:
    seq = await session.scalar(
        select(RunEvent.seq).where(RunEvent.run_id == run.id).order_by(RunEvent.seq.desc()).limit(1)
    )
    ev = RunEvent(
        tenant_id=run.tenant_id,
        run_id=run.id,
        seq=(seq or 0) + 1,
        kind=kind,
        payload=payload,
        created_at=utcnow(),
    )
    session.add(ev)
    await session.flush()
    await publish(run.tenant_id, f"run:{run.id}", {"event": kind, "seq": ev.seq, **payload})
    return ev


async def finish_run(
    session: AsyncSession,
    run: Run,
    *,
    status: RunStatus,
    output: dict[str, Any] | None = None,
    error: str = "",
) -> Run:
    run.status = status
    run.output = output
    run.error = error[:2000]
    run.finished_at = utcnow()
    await session.flush()
    await publish(run.tenant_id, f"run:{run.id}", {"event": "finished", "status": status.value})
    await publish(
        run.tenant_id, "runs", {"event": "updated", "id": str(run.id), "status": status.value}
    )
    return run


async def get_run(session: AsyncSession, tenant_id: uuid.UUID, run_id: uuid.UUID) -> Run:
    run = await session.get(Run, run_id)
    if not run or run.tenant_id != tenant_id:
        raise NotFound("run not found", code="run_not_found")
    return run


async def list_runs(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    status: RunStatus | None = None,
    kind: RunKind | None = None,
    conversation_id: uuid.UUID | None = None,
    agent_id: uuid.UUID | None = None,
    limit: int = 50,
) -> list[Run]:
    stmt = select(Run).where(Run.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(Run.status == status)
    if kind:
        stmt = stmt.where(Run.kind == kind)
    if conversation_id:
        stmt = stmt.where(Run.conversation_id == conversation_id)
    if agent_id:
        stmt = stmt.where(Run.agent_id == agent_id)
    stmt = stmt.order_by(Run.created_at.desc()).limit(limit)
    return list((await session.scalars(stmt)).all())


async def list_run_events(session: AsyncSession, run: Run) -> list[RunEvent]:
    stmt = select(RunEvent).where(RunEvent.run_id == run.id).order_by(RunEvent.seq)
    return list((await session.scalars(stmt)).all())


async def cancel_run(session: AsyncSession, run: Run) -> Run:
    if run.status in (RunStatus.done, RunStatus.failed, RunStatus.cancelled):
        raise Conflict("run already finished", code="run_finished")
    return await finish_run(session, run, status=RunStatus.cancelled)


# Triggers -------------------------------------------------------------------


def compute_next_fire(kind: TriggerKind, spec: dict[str, Any]):
    now = utcnow()
    if kind == TriggerKind.interval:
        minutes = int(spec.get("minutes") or 60)
        return now + timedelta(minutes=max(1, minutes))
    if kind == TriggerKind.cron:
        # Minimal cron: "HH:MM" daily or "every N hours". Full cron parsing is a module concern.
        at = str(spec.get("at") or "")
        if ":" in at:
            hh, mm = at.split(":", 1)
            candidate = now.replace(hour=int(hh), minute=int(mm), second=0, microsecond=0)
            if candidate <= now:
                candidate += timedelta(days=1)
            return candidate
        hours = int(spec.get("every_hours") or 24)
        return now + timedelta(hours=max(1, hours))
    return None


async def create_trigger(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    name: str,
    kind: TriggerKind,
    spec: dict[str, Any] | None = None,
    agent_id: uuid.UUID | None = None,
    playbook_id: uuid.UUID | None = None,
    instructions: str = "",
) -> Trigger:
    trigger = Trigger(
        tenant_id=tenant_id,
        name=name[:160],
        kind=kind,
        spec=spec or {},
        agent_id=agent_id,
        playbook_id=playbook_id,
        instructions=instructions,
        webhook_secret=secrets.token_urlsafe(24) if kind == TriggerKind.webhook else "",
        next_fire_at=compute_next_fire(kind, spec or {}),
    )
    session.add(trigger)
    await session.flush()
    return trigger


async def get_trigger(
    session: AsyncSession, tenant_id: uuid.UUID, trigger_id: uuid.UUID
) -> Trigger:
    t = await session.get(Trigger, trigger_id)
    if not t or t.tenant_id != tenant_id:
        raise NotFound("trigger not found", code="trigger_not_found")
    return t


async def list_triggers(session: AsyncSession, tenant_id: uuid.UUID) -> list[Trigger]:
    stmt = select(Trigger).where(Trigger.tenant_id == tenant_id).order_by(Trigger.name)
    return list((await session.scalars(stmt)).all())


async def due_triggers(session: AsyncSession, limit: int = 100) -> list[Trigger]:
    stmt = (
        select(Trigger)
        .where(
            Trigger.active.is_(True),
            Trigger.next_fire_at.is_not(None),
            Trigger.next_fire_at <= utcnow(),
        )
        .order_by(Trigger.next_fire_at)
        .limit(limit)
    )
    return list((await session.scalars(stmt)).all())
