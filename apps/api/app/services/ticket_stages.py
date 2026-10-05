"""Ticket stages: the pipeline a workstream defines for the cases it serves.

A ticket's status is always the kind of its current stage. Stage moves come
from three places: a run entering a step with a ``stage_key``, a run changing
state (waiting, resumed, completed), or a person moving the ticket by hand.
Every move is written to the conversation as a ``ticket_stage_changed`` event.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.case import TICKET_STAGE_KINDS, Case, CaseType
from app.models.orchestra import Workstream
from app.models.signal import SignalEvent

DEFAULT_TICKET_STAGES: list[dict[str, str]] = [
    {"key": "open", "name": "Open", "kind": "open"},
    {"key": "waiting", "name": "Waiting", "kind": "waiting"},
    {"key": "done", "name": "Done", "kind": "done"},
]


def parse_stages(raw: str | None) -> list[dict[str, str]]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        data = []
    stages: list[dict[str, str]] = []
    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "").strip()
            kind = str(item.get("kind") or "")
            if key and kind in TICKET_STAGE_KINDS:
                stages.append({"key": key, "name": str(item.get("name") or key), "kind": kind})
    return stages or [dict(s) for s in DEFAULT_TICKET_STAGES]


def workstream_stages(ws: Workstream | None) -> list[dict[str, str]]:
    return parse_stages(ws.stages_json if ws else None)


def validate_stages(raw: Any) -> str:
    """Normalize an operator-edited stage list to ``stages_json``."""
    from app.services.cases import slugify

    if not isinstance(raw, list) or not raw:
        raise HTTPException(status_code=400, detail="A ticket pipeline needs at least one stage")
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Invalid stage")
        name = str(item.get("name") or "").strip()
        kind = str(item.get("kind") or "")
        if not name or kind not in TICKET_STAGE_KINDS:
            raise HTTPException(status_code=400, detail="Each stage needs a name and a kind")
        key = slugify(str(item.get("key") or name))
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate stage '{name}'")
        seen.add(key)
        out.append({"key": key, "name": name[:60], "kind": kind})
    if not any(s["kind"] == "done" for s in out):
        raise HTTPException(status_code=400, detail="A ticket pipeline needs a done stage")
    return json.dumps(out)


def stage_payload(case: Case, stages: list[dict[str, str]] | None) -> dict[str, str] | None:
    if not stages or not case.stage_key:
        return None
    return next((dict(s) for s in stages if s["key"] == case.stage_key), None)


async def move_case_stage(
    session: AsyncSession,
    tenant_id: UUID,
    case: Case,
    *,
    stage_key: str | None = None,
    status: str | None = None,
    actor_type: str = "system",
    actor_id: str = "",
    ws: Workstream | None = None,
) -> bool:
    """Move a case to ``stage_key``, or to the first stage of ``status``'s kind.

    Cases without a workstream only change status. A status move keeps the
    current stage when it already has that kind. Returns whether anything changed.
    """
    if case.workstream_id is None:
        if status is None or case.status == status:
            return False
        case.status = status
        case.updated_at = datetime.utcnow()
        session.add(case)
        return True
    if ws is None or ws.id != case.workstream_id:
        ws = await session.get(Workstream, case.workstream_id)
    stages = workstream_stages(ws)
    current = next((s for s in stages if s["key"] == case.stage_key), None)
    if stage_key is not None:
        target = next((s for s in stages if s["key"] == stage_key), None)
        if target is None:
            raise HTTPException(status_code=400, detail="Unknown stage for this ticket")
    elif status is not None:
        if current is not None and current["kind"] == status:
            target = current
        else:
            target = next((s for s in stages if s["kind"] == status), None)
        if target is None:
            if case.status == status:
                return False
            case.status = status
            case.updated_at = datetime.utcnow()
            session.add(case)
            return True
    else:
        return False
    if current is not None and current["key"] == target["key"] and case.status == target["kind"]:
        return False
    case.stage_key = target["key"]
    case.status = target["kind"]
    case.updated_at = datetime.utcnow()
    session.add(case)
    session.add(
        SignalEvent(
            signal_id=case.signal_id,
            tenant_id=tenant_id,
            event_type="ticket_stage_changed",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps(
                {
                    "case_id": str(case.id),
                    "from_stage": current["name"] if current else None,
                    "to_stage": target["name"],
                    "to_kind": target["kind"],
                }
            ),
        )
    )
    return True


async def category_by_signal(
    session: AsyncSession, tenant_id: UUID, signal_ids: list[UUID]
) -> dict[UUID, dict[str, Any]]:
    """The category chip and ticket stage for each conversation in a list."""
    if not signal_ids:
        return {}
    rows = (
        await session.execute(
            select(Case, CaseType)
            .join(CaseType, Case.case_type_id == CaseType.id)
            .where(Case.tenant_id == tenant_id, Case.signal_id.in_(signal_ids))
        )
    ).all()
    ws_ids = {case.workstream_id for case, _ in rows if case.workstream_id}
    streams: dict[UUID, Workstream] = {}
    if ws_ids:
        streams = {
            ws.id: ws
            for ws in (
                await session.execute(select(Workstream).where(Workstream.id.in_(ws_ids)))
            ).scalars()
        }
    out: dict[UUID, dict[str, Any]] = {}
    for case, case_type in rows:
        ws = streams.get(case.workstream_id) if case.workstream_id else None
        out[case.signal_id] = {
            "case_id": str(case.id),
            "category_id": str(case_type.id),
            "name": case_type.name,
            "slug": case_type.slug,
            "status": case.status,
            "is_ticket": case.workstream_id is not None,
            "stage": stage_payload(case, workstream_stages(ws)) if ws else None,
        }
    return out
