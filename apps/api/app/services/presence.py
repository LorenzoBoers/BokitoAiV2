"""Availability of people, agents and teams.

People: ``available`` | ``away`` | ``offline`` — gateway stamps
``User.last_seen_at`` while a dashboard tab is connected; ``away`` is set by
the person and wins over a live connection.

Agents (avatar corner): ``working`` | ``standby`` | ``error``.

Teams roll up with hierarchy:
available person > working agent > away person > standby agent > offline.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, User

ONLINE_WINDOW = timedelta(minutes=3)
TOUCH_INTERVAL = timedelta(seconds=60)

AVAILABLE = "available"
AWAY = "away"
OFFLINE = "offline"
WORKING = "working"
STANDBY = "standby"
ERROR = "error"

TEAM_STATUSES = frozenset({AVAILABLE, AWAY, WORKING, STANDBY, OFFLINE})
AGENT_CORNER_STATUSES = frozenset({WORKING, STANDBY, ERROR})


def user_status(user: User, *, now: datetime | None = None) -> str:
    now = now or datetime.utcnow()
    if user.away and (user.away_until is None or user.away_until > now):
        return AWAY
    if user.last_seen_at and now - user.last_seen_at <= ONLINE_WINDOW:
        return AVAILABLE
    return OFFLINE


def serialize_presence(user: User, *, now: datetime | None = None) -> dict:
    now = now or datetime.utcnow()
    away_active = bool(user.away and (user.away_until is None or user.away_until > now))
    return {
        "status": user_status(user, now=now),
        "last_seen_at": user.last_seen_at.isoformat() if user.last_seen_at else None,
        "away_until": user.away_until.isoformat() if away_active and user.away_until else None,
    }


async def touch(session: AsyncSession, user_id: UUID, *, force: bool = False) -> bool:
    """Stamp last_seen_at; throttled so a ping does not write every time."""
    user = await session.get(User, user_id)
    if user is None:
        return False
    now = datetime.utcnow()
    if not force and user.last_seen_at and now - user.last_seen_at < TOUCH_INTERVAL:
        return False
    user.last_seen_at = now
    if user.away and user.away_until is not None and user.away_until <= now:
        user.away = False
        user.away_until = None
    session.add(user)
    await session.commit()
    return True


async def mark_offline(session: AsyncSession, user_id: UUID) -> None:
    """Called on the last disconnect: push last_seen_at out of the online window."""
    user = await session.get(User, user_id)
    if user is None:
        return
    now = datetime.utcnow()
    user.last_seen_at = now - ONLINE_WINDOW - timedelta(seconds=1)
    session.add(user)
    await session.commit()


async def set_away(
    session: AsyncSession, user: User, *, away: bool, until: datetime | None = None
) -> User:
    user.away = away
    user.away_until = until if away else None
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def statuses_for(
    session: AsyncSession, user_ids: Iterable[UUID]
) -> dict[UUID, str]:
    ids = list({uid for uid in user_ids if uid})
    if not ids:
        return {}
    now = datetime.utcnow()
    rows = (await session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    return {row.id: user_status(row, now=now) for row in rows}


async def anyone_available(
    session: AsyncSession, tenant_id: UUID, user_ids: Iterable[UUID] | None = None
) -> bool:
    """True when at least one person (of the given set, or the workspace) is available."""
    if user_ids is None:
        rows = await session.execute(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.tenant_id == tenant_id, User.is_active.is_(True), Membership.is_active.is_(True))
        )
        users = rows.scalars().all()
    else:
        ids = list(user_ids)
        if not ids:
            return False
        users = (await session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    now = datetime.utcnow()
    return any(user_status(u, now=now) == AVAILABLE for u in users)


def agent_status(raw: Any) -> str:
    """The one agent vocabulary: ``working`` | ``standby`` | ``error``."""
    value = str(raw or "").strip().lower()
    return value if value in AGENT_CORNER_STATUSES else STANDBY


def agent_corner_status(
    agent: Any,
    *,
    has_running_run: bool = False,
) -> str | None:
    """Corner status for a company agent, or ``None`` when not counted on a team.

    Skips archived / personal assistants. An open AgentRun counts as working.
    """
    if agent is None:
        return None
    if not bool(getattr(agent, "is_active", False)):
        return None
    if str(getattr(agent, "kind", "") or "") != "company":
        return None
    if bool(getattr(agent, "acts_for_user", False)):
        return None
    status = agent_status(getattr(agent, "runtime_status", None))
    if status == STANDBY and has_running_run:
        return WORKING
    return status


def team_status(
    people_statuses: Iterable[str],
    *,
    agent_statuses: Iterable[str] | None = None,
    active_agents: int = 0,
) -> str:
    """Aggregate team presence.

    Hierarchy: available > working > away > standby > offline.

    ``active_agents`` is deprecated; prefer ``agent_statuses``. When only
    ``active_agents`` is passed (legacy), each count maps to standby.
    """
    people = [str(s or "").strip().lower() for s in people_statuses]
    agents = [str(s or "").strip().lower() for s in (agent_statuses or [])]
    if not agents and active_agents > 0:
        agents = [STANDBY] * int(active_agents)
    if any(s == AVAILABLE for s in people):
        return AVAILABLE
    if any(s == WORKING for s in agents):
        return WORKING
    if any(s == AWAY for s in people):
        return AWAY
    if any(s == STANDBY for s in agents):
        return STANDBY
    return OFFLINE


def serialize_team_presence(status: str) -> dict:
    normalized = str(status or "").strip().lower()
    return {"status": normalized if normalized in TEAM_STATUSES else OFFLINE}
