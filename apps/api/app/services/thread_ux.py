"""Temporary log of dumb thread-UX events.

The client reports what the chat showed (a live line appeared, stayed, left).
There is no screen. Read the rows when someone says a moment felt rough.
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.signal import Signal

_NAMES = frozenset({"live_shown", "live_label", "live_held", "live_cleared", "stream_open", "stream_close"})
_DETAIL_KEYS = frozenset({"stream_id", "label_key", "ms", "ended", "streaming"})


def clean_event(raw: dict[str, Any]) -> dict[str, Any] | None:
    """Keep a short name and a few safe fields. Drop anything that could be message text."""
    name = str(raw.get("name") or "").strip().lower()[:40]
    if name not in _NAMES:
        return None
    detail: dict[str, Any] = {}
    incoming = raw.get("detail") if isinstance(raw.get("detail"), dict) else {}
    for key in _DETAIL_KEYS:
        if key not in incoming:
            continue
        value = incoming[key]
        if isinstance(value, bool) or isinstance(value, int):
            detail[key] = value
        elif isinstance(value, str):
            detail[key] = value.strip()[:80]
    return {"name": name, "detail": detail}


async def record_thread_ux(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    user_id: UUID | None,
    signal_id: UUID,
    events: list[dict[str, Any]],
) -> int:
    """Insert cleaned events for a thread in this tenant. Returns how many landed."""
    from sqlalchemy import text

    signal = (
        await session.execute(
            select(Signal.id).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if signal is None:
        return -1
    rows = [clean_event(item) for item in events[:20]]
    kept = [row for row in rows if row is not None]
    now = utcnow()
    for row in kept:
        await session.execute(
            text(
                """
                insert into thread_ux_events
                    (id, tenant_id, signal_id, user_id, name, detail, created_at)
                values
                    (:id, :tenant_id, :signal_id, :user_id, :name, cast(:detail as jsonb), :created_at)
                """
            ),
            {
                "id": uuid.uuid4(),
                "tenant_id": tenant_id,
                "signal_id": signal_id,
                "user_id": user_id,
                "name": row["name"],
                "detail": json.dumps(row["detail"]),
                "created_at": now,
            },
        )
    if kept:
        await session.commit()
    return len(kept)
