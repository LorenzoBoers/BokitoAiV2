"""Availability of people: available, away or offline.

The gateway stamps ``User.last_seen_at`` while a dashboard tab is connected.
``away`` is set by the person (optionally until a moment); it wins over a
live connection.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, User

ONLINE_WINDOW = timedelta(minutes=3)
TOUCH_INTERVAL = timedelta(seconds=60)

AVAILABLE = "available"
AWAY = "away"
OFFLINE = "offline"


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
            .where(Membership.tenant_id == tenant_id, User.is_active.is_(True))
        )
        users = rows.scalars().all()
    else:
        ids = list(user_ids)
        if not ids:
            return False
        users = (await session.execute(select(User).where(User.id.in_(ids)))).scalars().all()
    now = datetime.utcnow()
    return any(user_status(u, now=now) == AVAILABLE for u in users)
