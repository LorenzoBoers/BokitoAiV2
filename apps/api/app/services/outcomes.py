"""Operational outcome ingestion and feedback mapping."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.outcome import OUTCOME_KINDS, OperationalOutcome
from app.services.learning import submit_feedback


def _normalize_kind(payload: dict[str, Any]) -> str:
    subtype = str(payload.get("subtype") or payload.get("report_type") or "").lower()
    mapping = {
        "trade_closed": "trade_closed",
        "session_summary": "session_summary",
        "setup_skipped": "setup_skipped",
        "error": "error",
    }
    if subtype in mapping:
        return mapping[subtype]
    if payload.get("error") or payload.get("error_message"):
        return "error"
    if payload.get("pnl_r") is not None or payload.get("pnl") is not None:
        return "trade_closed"
    return "session_summary"


def _sentiment_from_payload(payload: dict[str, Any]) -> str | None:
    pnl = payload.get("pnl_r")
    if pnl is None:
        pnl = payload.get("pnl")
    if pnl is None:
        return None
    try:
        return "up" if float(pnl) >= 0 else "down"
    except (TypeError, ValueError):
        return None


def serialize_outcome(row: OperationalOutcome) -> dict[str, Any]:
    try:
        payload = json.loads(row.payload_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    return {
        "id": str(row.id),
        "tenant_id": str(row.tenant_id),
        "source": row.source,
        "kind": row.kind,
        "subtype": row.subtype,
        "payload": payload,
        "signal_id": str(row.signal_id) if row.signal_id else None,
        "created_at": row.created_at.isoformat(),
    }


async def record_outcome(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    source: str,
    kind: str,
    payload: dict[str, Any],
    subtype: str = "",
    signal_id: UUID | None = None,
) -> OperationalOutcome:
    if kind not in OUTCOME_KINDS:
        kind = _normalize_kind(payload)
    row = OperationalOutcome(
        tenant_id=tenant_id,
        source=source,
        kind=kind,
        subtype=subtype or str(payload.get("subtype") or ""),
        payload_json=json.dumps(payload),
        signal_id=signal_id,
    )
    session.add(row)
    await session.flush()
    await session.refresh(row)
    return row


async def ingest_trading_report(
    session: AsyncSession,
    tenant_id: UUID,
    payload: dict[str, Any],
    *,
    source: str = "trading_webhook",
    signal_id: UUID | None = None,
) -> OperationalOutcome:
    kind = _normalize_kind(payload)
    outcome = await record_outcome(
        session,
        tenant_id,
        source=source,
        kind=kind,
        payload=payload,
        signal_id=signal_id,
    )
    sentiment = _sentiment_from_payload(payload)
    if sentiment:
        subject_id = str(outcome.id)
        if signal_id:
            subject_id = str(signal_id)
        await submit_feedback(
            session,
            tenant_id,
            subject_type="signal" if signal_id else "run",
            subject_id=subject_id,
            sentiment=sentiment,
            comment=json.dumps(payload)[:2000],
        )
    return outcome


async def list_recent_outcomes(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    days: int = 7,
    kind: str | None = None,
    limit: int = 100,
) -> list[OperationalOutcome]:
    since = datetime.utcnow() - timedelta(days=days)
    stmt = (
        select(OperationalOutcome)
        .where(OperationalOutcome.tenant_id == tenant_id, OperationalOutcome.created_at >= since)
        .order_by(OperationalOutcome.created_at.desc())
        .limit(limit)
    )
    if kind:
        stmt = stmt.where(OperationalOutcome.kind == kind)
    result = await session.execute(stmt)
    return list(result.scalars().all())


def summarize_outcomes(rows: list[OperationalOutcome]) -> str:
    if not rows:
        return "No operational outcomes in the requested window."
    lines = [f"Recent outcomes ({len(rows)}):"]
    for row in rows[:20]:
        try:
            payload = json.loads(row.payload_json or "{}")
        except json.JSONDecodeError:
            payload = {}
        note = payload.get("notes") or payload.get("summary") or ""
        pnl = payload.get("pnl_r", payload.get("pnl"))
        extra = f" pnl={pnl}" if pnl is not None else ""
        lines.append(f"- [{row.kind}] {row.subtype or row.source}{extra}: {note[:200]}")
    return "\n".join(lines)
