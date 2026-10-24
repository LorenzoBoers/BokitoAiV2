"""Pins, the stack, and workspace members."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.agent import Agent
from app.models.auth import Membership, User, user_numeric_id
from app.models.signal import (
    Signal,
    SignalThreadPin,
)

logger = logging.getLogger(__name__)



async def _pinned_ids(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalThreadPin.signal_id).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
        )
    )
    return {row for row in result.scalars().all()}


async def _pinned_ids_in_order(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> list[UUID]:
    result = await session.execute(
        select(SignalThreadPin.signal_id)
        .where(SignalThreadPin.tenant_id == tenant_id, SignalThreadPin.user_id == user_id)
        .order_by(SignalThreadPin.created_at.asc(), SignalThreadPin.id.asc())
    )
    ordered: list[UUID] = []
    for signal_id in result.scalars().all():
        if signal_id not in ordered:
            ordered.append(signal_id)
    return ordered


async def list_pins(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> dict[str, list[str]]:
    pinned = await _pinned_ids_in_order(session, tenant_id, user_id)
    return {"thread_ids": [str(tid) for tid in pinned]}


STACK_LIMIT = 3
STACK_FOLLOW_LIMIT = 1
STACK_AGENTS_PER_CARD = 1


def _stack_title(signal: Signal, agent: Agent | None) -> str:
    for value in (signal.subject, signal.contact_name, signal.contact_email, signal.contact_phone):
        text = (value or "").strip()
        if text:
            return text
    return agent.name if agent else ""


def _stack_agent(agent: Agent, *, working: bool) -> dict[str, Any]:
    from app.services.signal_threads.serialize import _speaker_payload
    payload = _speaker_payload(agent)
    payload["working"] = working
    payload["summary"] = ((agent.current_activity_summary or "").strip() or None) if working else None
    return payload


async def list_stack(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    follow_ids: list[UUID],
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any]:
    """Cards and the agent rail for the dock."""
    from app.services.dock_agents import ALL_CALL_KEY, build_rail

    items = await _stack_items(
        session,
        tenant_id,
        user_id,
        follow_ids=follow_ids,
        visible_account_ids=visible_account_ids,
    )
    agents = await build_rail(session, tenant_id, user_id, items)
    return {"items": items, "agents": agents, "all_call_key": ALL_CALL_KEY}


async def _stack_items(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    follow_ids: list[UUID],
    visible_account_ids: set[UUID] | None = None,
) -> list[dict[str, Any]]:
    """Cards for the chat stack: the user's pinned threads, then followed ones.

    The dock holds at most ``STACK_LIMIT`` conversations. A followed thread
    keeps a seat. The remaining seats are the newest pins. Older pins stay
    pinned on the conversation and leave the dock.
    Threads outside the tenant or outside mailbox visibility drop out.
    Soft-deleted conversations still appear when the user explicitly pinned
    or followed them (pins and the call stack must stay in sync); they leave
    when the user dismisses or unpins. Personal-assistant threads stay out.
    Each card shows one agent: whoever is working, else whoever sent the last agent message, else the thread owner.
    """
    from app.services.pass_stick import viewer_unread_ids
    from app.services.personal_assistant import PERSONAL_THREAD_SOURCE
    from app.services.presence import WORKING, agent_status
    from app.services.signal_threads.queries import _visibility_predicate
    from app.services.signal_threads.serialize import (
        _iso,
        _latest_message_previews,
        floor_speaker_id,
    )

    pinned = await _pinned_ids_in_order(session, tenant_id, user_id)
    pinned_set = set(pinned)
    following: list[UUID] = []
    for fid in follow_ids:
        if fid in pinned_set or fid in following:
            continue
        following.append(fid)
        if len(following) >= STACK_FOLLOW_LIMIT * 4:
            break
    wanted = pinned + following
    if not wanted:
        return []

    # No alive() here: a pin or follow is an explicit hold. Trash still hides
    # the conversation from normal lists; the stack keeps it until dismissed.
    query = select(Signal).where(
        Signal.tenant_id == tenant_id,
        Signal.id.in_(wanted),
        Signal.source != PERSONAL_THREAD_SOURCE,
    )
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        query = query.where(acl)
    rows = {s.id: s for s in (await session.execute(query)).scalars().all()}
    visible_following = [fid for fid in following if fid in rows][:STACK_FOLLOW_LIMIT]
    pin_room = max(0, STACK_LIMIT - len(visible_following))
    kept_pins = pinned[-pin_room:] if pin_room else []
    threads = [rows[sid] for sid in kept_pins + visible_following if sid in rows]
    if not threads:
        return []
    thread_ids = [t.id for t in threads]

    previews, speaker_ids = await _latest_message_previews(session, tenant_id, thread_ids)
    working_rows = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant_id, Agent.current_signal_id.in_(thread_ids))
    )
    working_by_thread: dict[UUID, list[Agent]] = {}
    agents_by_id: dict[UUID, Agent] = {}
    for agent in working_rows.scalars().all():
        agents_by_id[agent.id] = agent
        if agent_status(agent.runtime_status) == WORKING and agent.current_signal_id:
            working_by_thread.setdefault(agent.current_signal_id, []).append(agent)

    face_ids: set[UUID] = set(speaker_ids.values())
    for t in threads:
        if t.agent_id:
            face_ids.add(t.agent_id)
        on_floor = floor_speaker_id(t)
        if on_floor:
            face_ids.add(on_floor)
    missing = face_ids - set(agents_by_id)
    if missing:
        extra = await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(missing))
        )
        agents_by_id.update({a.id: a for a in extra.scalars().all()})

    unread_mine = await viewer_unread_ids(session, tenant_id, user_id, thread_ids)
    items: list[dict[str, Any]] = []
    for t in threads:
        owner_agent = agents_by_id.get(t.agent_id) if t.agent_id else None
        working = working_by_thread.get(t.id, [])
        floor_id = floor_speaker_id(t)
        busy = next((a for a in working if a.id == floor_id), working[0] if working else None)
        agents: list[dict[str, Any]] = [_stack_agent(busy, working=True)] if busy is not None else []
        if not agents:
            for face_id in (speaker_ids.get(t.id), t.agent_id):
                face = agents_by_id.get(face_id) if face_id else None
                if face is None:
                    continue
                agents.append(_stack_agent(face, working=False))
                break
        preview, direction, by_agent = previews.get(t.id, ("", "", False))
        speaker = agents_by_id.get(speaker_ids[t.id]) if t.id in speaker_ids else None
        if by_agent:
            author = speaker.name if speaker else (owner_agent.name if owner_agent else None)
        elif direction == "inbound":
            author = (t.contact_name or "").strip() or None
        else:
            author = None
        items.append(
            {
                "id": str(t.id),
                "title": _stack_title(t, owner_agent),
                "preview": preview,
                "preview_author": author,
                "preview_by": "agent" if by_agent else ("contact" if direction == "inbound" else "team"),
                "unread": bool(t.has_unread or t.id in unread_mine),
                "status": t.status,
                "channel": t.channel,
                "pinned": t.id in pinned_set,
                "last_activity_at": _iso(t.last_message_at),
                "agents": agents[:STACK_AGENTS_PER_CARD],
            }
        )
    return items


async def pin_thread(session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID) -> None:
    existing = await session.execute(
        select(SignalThreadPin).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
            SignalThreadPin.signal_id == signal_id,
        )
    )
    if existing.scalar_one_or_none():
        return
    session.add(SignalThreadPin(tenant_id=tenant_id, user_id=user_id, signal_id=signal_id))
    await session.commit()


async def unpin_thread(session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID) -> None:
    existing = await session.execute(
        select(SignalThreadPin).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
            SignalThreadPin.signal_id == signal_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        await session.delete(row)
        await session.commit()


async def list_members(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant_id, User.is_active.is_(True), Membership.is_active.is_(True))
    )
    from app.services.presence import connected_user_ids_for, visible_user_status

    now = utcnow()
    connected = connected_user_ids_for(tenant_id)
    members = []
    for user, membership in result.all():
        members.append(
            {
                "id": user_numeric_id(user.id),
                "uuid": str(user.id),
                "name": user.display_name or user.email,
                "email": user.email,
                "avatar_url": user.avatar_url,
                "role": membership.role,
                "presence": visible_user_status(
                    user, connected=str(user.id) in connected, now=now
                ),
            }
        )
    return members
