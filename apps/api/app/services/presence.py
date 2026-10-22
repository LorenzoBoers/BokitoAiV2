"""Availability of people, agents and teams.

People: ``available`` | ``away`` | ``offline`` — gateway stamps
``User.last_seen_at`` while a dashboard tab is connected; ``away`` is set by
the person and wins over a live connection.

Agents (avatar corner): ``working`` | ``standby`` | ``error``.

Teams roll up with hierarchy:
available person > working agent > away person > standby agent > offline.
"""

from __future__ import annotations

from app.core.time import utcnow
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Membership, User

ONLINE_WINDOW = timedelta(minutes=3)
TOUCH_INTERVAL = timedelta(seconds=60)
# Reload / API restart drops the socket before the new one registers.
# Wait before writing offline so a live tab is not stamped away.
OFFLINE_GRACE = timedelta(seconds=15)

AVAILABLE = "available"
AWAY = "away"
OFFLINE = "offline"
WORKING = "working"
STANDBY = "standby"
ERROR = "error"

TEAM_STATUSES = frozenset({AVAILABLE, AWAY, WORKING, STANDBY, OFFLINE})
AGENT_CORNER_STATUSES = frozenset({WORKING, STANDBY, ERROR})


def _naive_utc(value: datetime | None) -> datetime | None:
    """Compare last_seen without mixing aware Postgres stamps and naive utcnow."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def user_status(user: User, *, now: datetime | None = None) -> str:
    now = _naive_utc(now) or utcnow()
    away_until = _naive_utc(user.away_until)
    if user.away and (away_until is None or away_until > now):
        return AWAY
    last_seen = _naive_utc(user.last_seen_at)
    if last_seen and now - last_seen <= ONLINE_WINDOW:
        return AVAILABLE
    return OFFLINE


def visible_user_status(user: User, *, connected: bool, now: datetime | None = None) -> str:
    """Status other clients should show.

    A live dashboard socket counts as available even when ``last_seen_at`` was
    just pushed out of the window by a tab that disconnected. Away still wins.
    """
    status = user_status(user, now=now)
    if connected and status == OFFLINE:
        return AVAILABLE
    return status


def serialize_presence(
    user: User, *, now: datetime | None = None, connected: bool = False
) -> dict:
    now = _naive_utc(now) or utcnow()
    away_until = _naive_utc(user.away_until)
    away_active = bool(user.away and (away_until is None or away_until > now))
    return {
        "status": visible_user_status(user, connected=connected, now=now),
        "last_seen_at": user.last_seen_at.isoformat() if user.last_seen_at else None,
        "away_until": user.away_until.isoformat() if away_active and user.away_until else None,
    }


def connected_user_ids_for(tenant_id: UUID | str) -> set[str]:
    """Dashboard sockets currently registered on this API process."""
    try:
        from app.gateway.manager import manager
    except Exception:
        return set()
    return manager.user_ids(str(tenant_id))


async def touch(session: AsyncSession, user_id: UUID, *, force: bool = False) -> bool:
    """Stamp last_seen_at; throttled so a ping does not write every time.

    Reloads the row first. The gateway session keeps objects after commit, so
    a disconnect on another socket can move ``last_seen_at`` without this
    connection noticing.
    """
    user = await session.get(User, user_id)
    if user is None:
        return False
    await session.refresh(user)
    now = utcnow()
    last_seen = _naive_utc(user.last_seen_at)
    if not force and last_seen and now - last_seen < TOUCH_INTERVAL:
        return False
    user.last_seen_at = now
    away_until = _naive_utc(user.away_until)
    if user.away and away_until is not None and away_until <= now:
        user.away = False
        user.away_until = None
    session.add(user)
    await session.commit()
    return True


async def mark_offline(session: AsyncSession, user_id: UUID) -> bool:
    """On the last disconnect, push last_seen_at out of the online window.

    Leaves a stamp from the last few seconds alone. That stamp belongs to a
    tab that just connected, and overwriting it is what left someone offline
    while their dashboard was open.
    """
    user = await session.get(User, user_id)
    if user is None:
        return False
    await session.refresh(user)
    now = utcnow()
    cutoff = now - timedelta(seconds=5)
    last_seen = _naive_utc(user.last_seen_at)
    if last_seen and last_seen > cutoff:
        return False
    stamp = now - ONLINE_WINDOW - timedelta(seconds=1)
    result = await session.execute(
        update(User)
        .where(
            User.id == user_id,
            or_(User.last_seen_at.is_(None), User.last_seen_at <= cutoff),
        )
        .values(last_seen_at=stamp)
    )
    await session.commit()
    await session.refresh(user)
    return bool(result.rowcount)


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
    now = utcnow()
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
    now = utcnow()
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


def _epoch_ms(value: datetime | None) -> int | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return int(value.timestamp() * 1000)


async def presence_snapshot(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    connected_user_ids: set[str],
    include_people: bool = True,
    include_agents: bool = True,
) -> list[tuple[str, dict[str, Any]]]:
    """Current people and agent status for a client that just subscribed.

    The connect-time presence event is published before the client has joined
    the topic, so without this replay the dashboard keeps the REST seed
    (often offline) for the whole session.
    """
    now = utcnow()
    events: list[tuple[str, dict[str, Any]]] = []
    if include_people:
        rows = (
            await session.execute(
                select(User)
                .join(Membership, Membership.user_id == User.id)
                .where(
                    Membership.tenant_id == tenant_id,
                    User.is_active.is_(True),
                    Membership.is_active.is_(True),
                )
            )
        ).scalars().all()
        for user in rows:
            status = visible_user_status(
                user, connected=str(user.id) in connected_user_ids, now=now
            )
            events.append(
                (
                    "presence",
                    {
                        "user_id": str(user.id),
                        "device": "dashboard",
                        "online": status != OFFLINE,
                        "status": status,
                    },
                )
            )
    if include_agents:
        agents = (
            await session.execute(
                select(Agent).where(Agent.tenant_id == tenant_id, Agent.is_active.is_(True))
            )
        ).scalars().all()
        for agent in agents:
            status = agent_corner_status(agent)
            if status is None:
                continue
            events.append(
                (
                    "agent.status",
                    {
                        "agent_id": str(agent.id),
                        "status": status,
                        "summary": (agent.current_activity_summary or "").strip() or None,
                        "thread_id": str(agent.current_signal_id) if agent.current_signal_id else None,
                        "activity_id": None,
                        "last_active_at": _epoch_ms(agent.last_active_at),
                    },
                )
            )
    return events
