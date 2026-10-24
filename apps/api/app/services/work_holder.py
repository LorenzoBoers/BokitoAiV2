"""Who may act on a conversation: the holder rule of the organization model.

One department is responsible for a conversation (``department_of_signal``)
and one agent holds it. Mutating tools are for the holder, for an agent the
holder asked (an open ``AgentAsk``), and for an agent a person addressed in
this turn. Anyone in the responsible branch or above may take the work over
explicitly with ``take_over``. Everyone else reads, asks or hands over.

Only enforced while the tenant has ``org_rules`` on.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.agent_turn import AgentAsk
from app.models.signal import Signal, SignalEvent
from app.models.team import Department

# Asking, handing over and plain notes never mutate the work itself.
ALWAYS_ALLOWED = frozenset(
    {
        "ask_agent",
        "handoff_to",
        "take_over",
        "post_internal_note",
        "react_to_message",
        "record_thread_read",
    }
)


@dataclass
class Responsibility:
    department_id: UUID | None
    department_name: str
    holder_agent_id: UUID | None
    holder_name: str


def holder_agent_id(signal: Signal) -> UUID | None:
    """The agent holding the conversation: the agent owner, else the handling pin."""
    if signal.assignee_kind == "agent" and signal.assignee_id:
        return signal.assignee_id
    return signal.agent_id


def _exempt(signal: Signal) -> bool:
    """Department rooms and personal assistant threads have no holder to respect."""
    from app.services.awareness import room_department_id

    return signal.channel == "assistant" or room_department_id(signal) is not None


async def responsibility(session: AsyncSession, signal: Signal) -> Responsibility:
    from app.services.department_access import department_contact
    from app.services.department_domain import department_of_signal

    department_id = await department_of_signal(session, signal)
    dept = await session.get(Department, department_id) if department_id else None
    holder_id = holder_agent_id(signal)
    holder = await session.get(Agent, holder_id) if holder_id else None
    if holder is None and dept is not None:
        holder, _implicit = await department_contact(session, signal.tenant_id, dept.id)
    holder_name = holder.name if holder is not None else ""
    if not holder_name and signal.assignee_kind == "user" and signal.assignee_id:
        from app.models.auth import User

        user = await session.get(User, signal.assignee_id)
        holder_name = (user.display_name or user.email) if user else ""
    return Responsibility(
        department_id=dept.id if dept else None,
        department_name=_department_label(dept),
        holder_agent_id=holder.id if holder is not None else None,
        holder_name=holder_name,
    )


def _department_label(dept: Department | None) -> str:
    from app.models.team import is_root_department

    if dept is None or is_root_department(dept):
        return "the organization"
    return dept.name


async def _asked_by_holder(session: AsyncSession, signal: Signal, agent_id: UUID, holder_id: UUID | None) -> bool:
    if holder_id is None:
        return False
    found = (
        await session.execute(
            select(AgentAsk.id).where(
                AgentAsk.signal_id == signal.id,
                AgentAsk.from_agent_id == holder_id,
                AgentAsk.to_agent_id == agent_id,
                AgentAsk.status == "open",
            )
        )
    ).first()
    return found is not None


async def may_act(
    session: AsyncSession, signal: Signal | None, agent: Agent, *, operator_asked: bool = False
) -> tuple[bool, str]:
    """(allowed, refusal) for a mutating tool by ``agent`` on ``signal``."""
    if signal is None or _exempt(signal) or operator_asked:
        return True, ""
    who = await responsibility(session, signal)
    if who.holder_agent_id == agent.id:
        return True, ""
    if who.holder_agent_id is None and who.department_id is None:
        return True, ""
    if await _asked_by_holder(session, signal, agent.id, who.holder_agent_id):
        return True, ""
    holder = f" (holder: {who.holder_name})" if who.holder_name else ""
    return False, (
        f"This conversation is with {who.department_name}{holder}. Use ask_agent or handoff_to, "
        f"or take_over when you sit in {who.department_name} or above."
    )


async def may_take_over(session: AsyncSession, signal: Signal, agent: Agent) -> tuple[bool, str]:
    """Crew of the responsible department or of a department above it may take over."""
    from app.services.teams import department_chain, direct_department_ids

    who = await responsibility(session, signal)
    if who.holder_agent_id == agent.id:
        return False, "You already hold this conversation."
    chain = set(await department_chain(session, signal.tenant_id, who.department_id))
    if await direct_department_ids(session, signal.tenant_id, "agent", agent.id) & chain:
        return True, ""
    return False, (
        f"Only the crew of {who.department_name} or a department above it can take this over. "
        "Use ask_agent or handoff_to."
    )


async def take_over(session: AsyncSession, signal: Signal, agent: Agent) -> dict:
    """Make ``agent`` the holder, with a timeline event and an audit row. Caller commits."""
    from app.services.audit import record_audit
    from app.services.ownership import apply_owner

    allowed, refusal = await may_take_over(session, signal, agent)
    if not allowed:
        return {"ok": False, "error": refusal}
    who = await responsibility(session, signal)
    await apply_owner(session, signal, "agent", agent.id)
    signal.agent_id = agent.id
    session.add(signal)
    payload = {
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "from_department": who.department_name,
        "from_holder": who.holder_name,
    }
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="taken_over",
            actor_type="agent",
            actor_id=str(agent.id),
            payload_json=json.dumps(payload),
        )
    )
    await record_audit(
        session,
        signal.tenant_id,
        action="signal:take_over",
        actor_type="agent",
        actor_id=str(agent.id),
        agent_id=agent.id,
        resource_type="signal",
        resource_id=str(signal.id),
        summary=f"{agent.name} took over from {who.department_name}",
        payload=payload,
        commit=False,
    )
    await session.flush()
    return {"ok": True, **payload}


__all__ = [
    "ALWAYS_ALLOWED",
    "Responsibility",
    "holder_agent_id",
    "may_act",
    "may_take_over",
    "responsibility",
    "take_over",
]
