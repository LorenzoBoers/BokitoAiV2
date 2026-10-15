"""Conversation participants: who is involved (not only who owns)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import User
from app.models.channel import Contact
from app.models.signal import Signal
from app.models.signal_participant import (
    PARTICIPANT_KINDS,
    PARTICIPANT_ROLES,
    SignalParticipant,
)
from app.models.team import Team
from app.services.agent_avatar import avatar_payload


async def list_active_participants(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> list[SignalParticipant]:
    rows = (
        await session.execute(
            select(SignalParticipant).where(
                SignalParticipant.tenant_id == tenant_id,
                SignalParticipant.signal_id == signal_id,
                SignalParticipant.left_at.is_(None),
            )
        )
    ).scalars().all()
    return list(rows)


async def ensure_participant(
    session: AsyncSession,
    signal: Signal,
    *,
    kind: str,
    ref_id: UUID,
    role: str = "member",
    invited_by_kind: str = "",
    invited_by_id: UUID | None = None,
    joined_via: str = "invite",
) -> SignalParticipant:
    if kind not in PARTICIPANT_KINDS:
        raise ValueError(f"Invalid participant kind: {kind}")
    if role not in PARTICIPANT_ROLES:
        raise ValueError(f"Invalid participant role: {role}")
    existing = (
        await session.execute(
            select(SignalParticipant).where(
                SignalParticipant.tenant_id == signal.tenant_id,
                SignalParticipant.signal_id == signal.id,
                SignalParticipant.kind == kind,
                SignalParticipant.ref_id == ref_id,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        if existing.left_at is not None:
            existing.left_at = None
            existing.joined_at = datetime.utcnow()
            existing.joined_via = joined_via or existing.joined_via
            existing.invited_by_kind = invited_by_kind or existing.invited_by_kind
            existing.invited_by_id = invited_by_id or existing.invited_by_id
        # Promote to owner when ownership sync asks for it.
        if role == "owner" and existing.role != "owner":
            existing.role = "owner"
        session.add(existing)
        return existing
    row = SignalParticipant(
        tenant_id=signal.tenant_id,
        signal_id=signal.id,
        kind=kind,
        ref_id=ref_id,
        role=role,
        invited_by_kind=invited_by_kind or "",
        invited_by_id=invited_by_id,
        joined_via=joined_via or "",
    )
    session.add(row)
    return row


async def leave_participant(
    session: AsyncSession,
    signal: Signal,
    *,
    kind: str,
    ref_id: UUID,
) -> bool:
    existing = (
        await session.execute(
            select(SignalParticipant).where(
                SignalParticipant.tenant_id == signal.tenant_id,
                SignalParticipant.signal_id == signal.id,
                SignalParticipant.kind == kind,
                SignalParticipant.ref_id == ref_id,
                SignalParticipant.left_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        return False
    if existing.role == "owner":
        raise ValueError("Cannot remove the conversation owner; reassign first")
    existing.left_at = datetime.utcnow()
    session.add(existing)
    return True


async def sync_owner_participant(session: AsyncSession, signal: Signal) -> None:
    """Keep the owner row in sync after ``set_owner``."""
    kind = (signal.assignee_kind or "").strip()
    ref: UUID | None = None
    if kind == "user":
        ref = signal.assigned_user_id
    elif kind == "agent":
        ref = signal.agent_id
    elif kind == "team":
        ref = signal.assignee_team_id
    if not kind or ref is None:
        return
    # Demote previous owners of a different kind/ref.
    active = await list_active_participants(session, signal.tenant_id, signal.id)
    for row in active:
        if row.role == "owner" and (row.kind != kind or row.ref_id != ref):
            row.role = "member"
            session.add(row)
    await ensure_participant(
        session, signal, kind=kind, ref_id=ref, role="owner", joined_via="assign"
    )


async def sync_signal_baseline(session: AsyncSession, signal: Signal) -> None:
    """Ensure contact / chat partner / personal owner are participants."""
    await sync_owner_participant(session, signal)
    if signal.agent_id and signal.assignee_kind != "agent":
        await ensure_participant(
            session,
            signal,
            kind="agent",
            ref_id=signal.agent_id,
            role="member",
            joined_via="backfill",
        )
    if signal.contact_id:
        await ensure_participant(
            session,
            signal,
            kind="contact",
            ref_id=signal.contact_id,
            role="member",
            joined_via="backfill",
        )
    if signal.owner_user_id:
        await ensure_participant(
            session,
            signal,
            kind="user",
            ref_id=signal.owner_user_id,
            role="member",
            joined_via="backfill",
        )


async def is_participant(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    kind: str,
    ref_id: UUID,
) -> bool:
    row = (
        await session.execute(
            select(SignalParticipant.id).where(
                SignalParticipant.tenant_id == tenant_id,
                SignalParticipant.signal_id == signal_id,
                SignalParticipant.kind == kind,
                SignalParticipant.ref_id == ref_id,
                SignalParticipant.left_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    return row is not None


async def serialize_participants(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> list[dict[str, Any]]:
    rows = await list_active_participants(session, tenant_id, signal_id)
    if not rows:
        return []

    user_ids = [r.ref_id for r in rows if r.kind == "user"]
    agent_ids = [r.ref_id for r in rows if r.kind == "agent"]
    contact_ids = [r.ref_id for r in rows if r.kind == "contact"]
    team_ids = [r.ref_id for r in rows if r.kind == "team"]

    users: dict[UUID, User] = {}
    if user_ids:
        for u in (
            await session.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars():
            users[u.id] = u
    agents: dict[UUID, Agent] = {}
    if agent_ids:
        for a in (
            await session.execute(
                select(Agent).where(Agent.id.in_(agent_ids), Agent.tenant_id == tenant_id)
            )
        ).scalars():
            agents[a.id] = a
    contacts: dict[UUID, Contact] = {}
    if contact_ids:
        for c in (
            await session.execute(
                select(Contact).where(
                    Contact.id.in_(contact_ids), Contact.tenant_id == tenant_id
                )
            )
        ).scalars():
            contacts[c.id] = c
    teams: dict[UUID, Team] = {}
    if team_ids:
        for t in (
            await session.execute(
                select(Team).where(Team.id.in_(team_ids), Team.tenant_id == tenant_id)
            )
        ).scalars():
            teams[t.id] = t

    out: list[dict[str, Any]] = []
    for row in rows:
        name = ""
        email = ""
        avatar: dict[str, Any] = {}
        if row.kind == "user":
            u = users.get(row.ref_id)
            if u:
                name = (
                    (u.display_name or "").strip()
                    or " ".join(
                        x for x in (u.first_name or "", u.last_name or "") if x
                    ).strip()
                    or u.email
                    or ""
                )
                email = u.email or ""
        elif row.kind == "agent":
            a = agents.get(row.ref_id)
            if a:
                name = a.name or ""
                avatar = avatar_payload(a)
        elif row.kind == "contact":
            c = contacts.get(row.ref_id)
            if c:
                # Contact: display_name + address (not name/email).
                name = (c.display_name or "").strip() or c.address or c.phone or ""
                email = c.address if (c.channel or "") == "email" else ""
        elif row.kind == "team":
            t = teams.get(row.ref_id)
            if t:
                name = t.name or ""
        out.append(
            {
                "id": str(row.id),
                "kind": row.kind,
                "ref_id": str(row.ref_id),
                "role": row.role,
                "name": name,
                "email": email,
                "joined_via": row.joined_via or "",
                "joined_at": row.joined_at.isoformat() if row.joined_at else None,
                "avatar_kind": avatar.get("avatar_kind"),
                "avatar_icon": avatar.get("avatar_icon"),
                "avatar_color": avatar.get("avatar_color"),
                "avatar_shape": avatar.get("avatar_shape"),
                "avatar_image_url": avatar.get("avatar_image_url"),
            }
        )
    # Owners first, then agents, then people.
    rank = {"owner": 0, "member": 1, "watcher": 2}
    kind_rank = {"agent": 0, "user": 1, "team": 2, "contact": 3}
    out.sort(key=lambda p: (rank.get(p["role"], 9), kind_rank.get(p["kind"], 9), p["name"]))
    return out
