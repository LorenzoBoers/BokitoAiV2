"""Archived agents stay on old messages. They do not keep a live conversation."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.agent import Agent
from app.models.signal import Signal
from app.models.signal_participant import SignalParticipant


def agent_is_live(agent: Agent | None) -> bool:
    return bool(agent and agent.is_active and agent.kind != "archived")


async def retarget_archived_handler(session: AsyncSession, signal: Signal) -> bool:
    """Point a conversation off an archived agent and onto the workspace lead.

    Past messages keep their author. The header, Ask target, and open floor do not.
    """
    stale_ids: set[UUID] = set()
    if signal.agent_id:
        pinned = await session.get(Agent, signal.agent_id)
        if not agent_is_live(pinned):
            stale_ids.add(signal.agent_id)
    if signal.assignee_kind == "agent" and signal.assignee_id:
        owner = await session.get(Agent, signal.assignee_id)
        if not agent_is_live(owner):
            stale_ids.add(signal.assignee_id)

    floor = signal._floor()
    active = floor.get("active_turn") if isinstance(floor, dict) else None
    floor_stale = False
    if isinstance(active, dict) and active.get("kind") == "agent" and active.get("ref_id"):
        try:
            floor_id = UUID(str(active["ref_id"]))
        except (TypeError, ValueError):
            floor_id = None
        if floor_id is not None:
            floor_agent = await session.get(Agent, floor_id)
            if not agent_is_live(floor_agent):
                floor_stale = True
                stale_ids.add(floor_id)

    if not stale_ids and not floor_stale:
        return False

    from app.services.lead_agent import get_lead_agent
    from app.services.ownership import apply_owner
    from app.services.participant_turns import clear_active_turn

    lead = await get_lead_agent(session, signal.tenant_id)
    if signal.assignee_kind == "agent" and signal.assignee_id in stale_ids and lead is not None:
        await apply_owner(session, signal, "agent", lead.id)
    elif signal.agent_id in stale_ids:
        signal.agent_id = lead.id if lead is not None else None

    if floor_stale:
        clear_active_turn(signal)

    if stale_ids:
        rows = (
            await session.execute(
                select(SignalParticipant).where(
                    SignalParticipant.tenant_id == signal.tenant_id,
                    SignalParticipant.signal_id == signal.id,
                    SignalParticipant.kind == "agent",
                    SignalParticipant.ref_id.in_(stale_ids),
                    SignalParticipant.left_at.is_(None),
                )
            )
        ).scalars().all()
        for row in rows:
            if lead is not None and row.ref_id == lead.id:
                continue
            if row.role == "owner" and signal.assignee_id == row.ref_id:
                continue
            row.left_at = utcnow()
            if row.role == "owner":
                row.role = "member"
            session.add(row)

    session.add(signal)
    return True


async def retarget_threads_for_agent(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> int:
    """Move every conversation still pinned to this agent."""
    rows = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id,
                or_(
                    Signal.agent_id == agent_id,
                    (Signal.assignee_kind == "agent") & (Signal.assignee_id == agent_id),
                ),
            )
        )
    ).scalars().all()
    changed = 0
    for signal in rows:
        if await retarget_archived_handler(session, signal):
            changed += 1
    return changed
