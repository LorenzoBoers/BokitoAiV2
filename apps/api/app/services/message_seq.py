"""Per-thread order of messages.

Every ``SignalMessage`` gets ``seq`` from its thread's ``signals.last_seq``.
A row inserted without one takes the next number in the same flush. An agent
bubble takes its number when its first token streams (``reserve_seq``), so
a message posted by a tool later in the turn sorts after it.
"""

from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import Integer, Uuid, bindparam, event, text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.models.signal import SignalMessage

logger = logging.getLogger(__name__)

_BUMP = text(
    "UPDATE signals SET last_seq = last_seq + :n WHERE id = :id RETURNING last_seq"
).bindparams(bindparam("id", type_=Uuid()), bindparam("n", type_=Integer()))


@event.listens_for(SignalMessage, "before_insert")
def _assign_seq(_mapper, connection, target: SignalMessage) -> None:
    if target.seq is not None or target.signal_id is None:
        return
    row = connection.execute(_BUMP, {"n": 1, "id": target.signal_id}).first()
    if row is not None:
        target.seq = int(row[0])


async def next_seq(session, signal_id: UUID) -> int | None:
    """The next number inside the caller's transaction (moves a row to the end)."""
    row = (await session.execute(_BUMP, {"n": 1, "id": signal_id})).first()
    return int(row[0]) if row is not None else None


async def reserve_seq(bind: AsyncEngine | None, signal_id: UUID | None) -> int | None:
    """Take the next number in its own short transaction. None on SQLite or a held lock."""
    if bind is None or signal_id is None:
        return None
    if bind.dialect.name != "postgresql":
        return None
    try:
        async with bind.begin() as conn:
            await conn.execute(text("SET LOCAL lock_timeout = '1500ms'"))
            row = (await conn.execute(_BUMP, {"n": 1, "id": signal_id})).first()
            return int(row[0]) if row is not None else None
    except Exception:  # noqa: BLE001
        logger.info("seq reservation skipped for %s", signal_id)
        return None
