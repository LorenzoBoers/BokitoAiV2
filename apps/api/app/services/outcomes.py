"""Trading webhook ingest — outcomes table retired.

Previously wrote ``operational_outcomes``. New ingest posts a ``SignalEvent``
on the wake thread so the transcript stays the log. Learning and
introspection no longer query a side table.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.signal import SignalEvent

OUTCOME_KINDS = ("trade_closed", "session_summary", "setup_skipped", "error")


def _sentiment_from_payload(payload: dict[str, Any]) -> str:
    raw = str(payload.get("sentiment") or payload.get("mood") or "").strip().lower()
    if raw in ("up", "down", "positive", "negative", "neutral"):
        return raw
    pnl = payload.get("pnl") or payload.get("profit")
    try:
        value = float(pnl)
    except (TypeError, ValueError):
        return "neutral"
    if value > 0:
        return "positive"
    if value < 0:
        return "negative"
    return "neutral"


def summarize_outcomes(rows: list[Any]) -> str:
    """Kept for call-site compatibility; always empty after table drop."""
    del rows
    return ""


async def list_recent_outcomes(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    days: int = 7,
    kind: str | None = None,
) -> list[Any]:
    del session, tenant_id, days, kind
    return []


async def ingest_trading_report(
    session: AsyncSession,
    tenant_id: UUID,
    payload: dict[str, Any],
    *,
    source: str = "trading_webhook",
    signal_id: UUID | None = None,
) -> SignalEvent:
    """Record a structured trading report as a thread event."""
    raw_kind = str(payload.get("kind") or "").strip()
    subtype = str(payload.get("subtype") or payload.get("setup") or "")[:120]
    # Webhook envelope uses kind=report; the outcome kind sits in subtype.
    kind = subtype if raw_kind == "report" and subtype in OUTCOME_KINDS else raw_kind
    if kind not in OUTCOME_KINDS:
        kind = "session_summary"
    if signal_id is None:
        raise ValueError("signal_id is required to ingest a trading report")
    event = SignalEvent(
        signal_id=signal_id,
        tenant_id=tenant_id,
        event_type="trading_report",
        actor_type="system",
        actor_id=source,
        payload_json=json.dumps(
            {
                "kind": kind,
                "subtype": subtype,
                "source": source,
                "sentiment": _sentiment_from_payload(payload),
                "payload": payload,
            },
            default=str,
        ),
        created_at=utcnow(),
    )
    session.add(event)
    await session.flush()
    return event
