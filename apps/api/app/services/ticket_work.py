"""Ticket work: how an agent places a ticket, its deadline, checklist and next step.

Generic mechanisms on top of a flow's stages; nothing here knows an industry.

- **Stage entry.** A flow's ``stage_entry_policy`` (empty follows the
  workspace ``signals.stage_entry_policy``) decides what an agent's stage move
  does: ``first_stage`` - people move the stages, the agent is told so;
  ``propose`` - the move becomes a decision in the thread; ``auto_above`` -
  the agent moves when its certainty reaches ``stage_entry_threshold``, else
  it proposes. People always move directly. The Govern posture still gates
  the ``tickets`` tools before any of this runs.
- **Deadline.** ``Signal.due_at`` with ``due_source`` (statutory, requested,
  agreed, manual) and a short ``due_basis``. An agent only proposes one. A
  time of exactly midnight means the end of that day.
- **Checklist.** A stage may list items (``checklist``) and require them before
  the ticket moves on (``exit_requires_checklist``). An agent's tick is a
  proposal; a person confirms it.
- **Next step.** Derived on read from the stage, the turn, open required items
  and the deadline. Clients only render it.

Proposals are ordinary ``DecisionRequest`` rows in the thread
(``source_type`` ``ticket_stage`` / ``ticket_due``); approving one runs
``update_ticket`` as the person. Each outcome is stored as ``Feedback``.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal, SignalEvent, SignalTag

ENTRY_POLICIES = ("first_stage", "propose", "auto_above")
DEFAULT_ENTRY_POLICY = "propose"
DEFAULT_ENTRY_THRESHOLD = 8
DEFAULT_DUE_SOON_DAYS = 7

DUE_SOURCES = ("statutory", "requested", "agreed", "manual")
WAITING_ON = ("customer", "us", "third_party")
EVIDENCE_KINDS = ("attachment", "answer", "manual")
MAX_CHECKLIST_ITEMS = 12

STAGE_PROPOSAL = "ticket_stage"
DUE_PROPOSAL = "ticket_due"
PROPOSAL_SOURCES = (STAGE_PROPOSAL, DUE_PROPOSAL)


# ---------------------------------------------------------------------------
# Stage config


def parse_waiting_on(raw: Any) -> str:
    value = str(raw or "").strip().lower()
    return value if value in WAITING_ON else ""


def parse_checklist(raw: Any) -> list[dict[str, Any]]:
    """Checklist items on a stage: ``{key, label, required, evidence}``."""
    from app.services.tickets import slugify

    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw[:MAX_CHECKLIST_ITEMS]:
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if not label:
            continue
        key = slugify(str(item.get("key") or label))
        if key in seen:
            continue
        seen.add(key)
        evidence = str(item.get("evidence") or "manual").strip().lower()
        out.append(
            {
                "key": key,
                "label": label[:120],
                "required": bool(item.get("required")),
                "evidence": evidence if evidence in EVIDENCE_KINDS else "manual",
            }
        )
    return out


def validate_checklist_keys(stages: list[dict[str, Any]]) -> None:
    """Item keys are unique across the flow, so a ticket's state stays unambiguous."""
    seen: dict[str, str] = {}
    for stage in stages:
        for item in stage.get("checklist") or []:
            other = seen.get(item["key"])
            if other is not None:
                raise HTTPException(
                    status_code=400,
                    detail=f"Checklist item '{item['label']}' appears in '{other}' and '{stage['name']}'",
                )
            seen[item["key"]] = stage["name"]


# ---------------------------------------------------------------------------
# Stage entry policy


def entry_policy(ws: Any, tenant: Any) -> tuple[str, int]:
    """The flow's policy and threshold, falling back to the workspace default."""
    from app.services.signal_catalog import signal_policy

    workspace = signal_policy(tenant)
    policy = str(getattr(ws, "stage_entry_policy", "") or "")
    if policy not in ENTRY_POLICIES:
        policy = workspace["stage_entry_policy"]
    threshold = getattr(ws, "stage_entry_threshold", None)
    if threshold is None:
        threshold = workspace["stage_entry_threshold"]
    return policy, max(0, min(10, int(threshold)))


def agent_places_directly(policy: str, threshold: int, certainty: int | None) -> bool:
    return policy == "auto_above" and certainty is not None and int(certainty) >= threshold


def _stage_index(stages: list[dict[str, Any]], key: str | None) -> int:
    return next((i for i, s in enumerate(stages) if s["key"] == key), -1)


def resolve_target(
    stages: list[dict[str, Any]], current_key: str | None, *, stage_key: str | None, status: str | None
) -> dict[str, Any] | None:
    """The stage a move asks for (same rule as ``tickets.move_ticket_stage``)."""
    if stage_key:
        target = next((s for s in stages if s["key"] == stage_key), None)
        if target is None:
            raise HTTPException(status_code=400, detail="Unknown stage for this ticket")
        return target
    if status:
        current = next((s for s in stages if s["key"] == current_key), None)
        if current is not None and current["kind"] == status:
            return current
        return next((s for s in stages if s["kind"] == status), None)
    return None


async def _open_proposals(session: AsyncSession, signal: Signal, source_type: str) -> list[Any]:
    from app.models.notification import DecisionRequest

    return list(
        (
            await session.execute(
                select(DecisionRequest).where(
                    DecisionRequest.tenant_id == signal.tenant_id,
                    DecisionRequest.signal_id == signal.id,
                    DecisionRequest.source_type == source_type,
                    DecisionRequest.status == "awaiting_human",
                )
            )
        ).scalars()
    )


def _option_payload(row: Any) -> dict[str, Any]:
    try:
        options = json.loads(row.options_json or "[]")
    except json.JSONDecodeError:
        return {}
    for option in options:
        if isinstance(option, dict) and option.get("id") == "approve" and isinstance(option.get("payload"), dict):
            return option["payload"]
    return {}


async def _supersede(
    session: AsyncSession, signal: Signal, source_type: str, *, user_id: UUID | None = None, chosen: str = ""
) -> None:
    """Close open proposals of this kind. A person's own choice is recorded as a correction."""
    now = datetime.utcnow()
    for row in await _open_proposals(session, signal, source_type):
        proposed = _option_payload(row)
        row.status = "deferred"
        row.chosen_option_id = "superseded"
        row.resolved_at = now
        row.resolved_by_user_id = user_id
        session.add(row)
        if user_id is not None:
            key = "stage_key" if source_type == STAGE_PROPOSAL else "due_at"
            agreed = str(proposed.get(key) or "") == chosen
            _feedback(session, signal, source_type, agreed=agreed, user_id=user_id, proposed=proposed, chosen=chosen)


async def propose_stage(
    session: AsyncSession,
    signal: Signal,
    tag: SignalTag,
    target: dict[str, Any],
    *,
    current: dict[str, Any] | None,
    certainty: int | None,
    reason: str,
    agent_id: UUID | None,
) -> dict[str, Any]:
    """Ask the owner to confirm an agent's stage move. Flushes."""
    from app.services.signal_decisions import create_decision

    await _supersede(session, signal, STAGE_PROPOSAL)
    sure = f" (certainty {certainty}/10)" if certainty is not None else ""
    where = f"from {current['name']} " if current else ""
    summary = (reason.strip() or f"Move this #{tag.name} ticket {where}to {target['name']}.") + sure
    decision, _message = await create_decision(
        session,
        signal.tenant_id,
        title=f"#{tag.name}: move to {target['name']}?",
        summary=summary[:500],
        options=[
            {
                "id": "approve",
                "label": f"Move to {target['name']}",
                "action_type": "update_ticket",
                "payload": {"signal_id": str(signal.id), "stage_key": target["key"]},
            },
            {"id": "reject", "label": f"Keep in {current['name']}" if current else "Keep"},
        ],
        agent_id=agent_id,
        signal_id=signal.id,
        source_type=STAGE_PROPOSAL,
        source_id=str(signal.id),
    )
    _event(
        session,
        signal,
        "ticket_stage_proposed",
        "agent" if agent_id else "system",
        str(agent_id or ""),
        {"to_key": target["key"], "to_stage": target["name"], "certainty": certainty, "decision_id": str(decision.id)},
    )
    return {"proposed": True, "decision_id": str(decision.id), "stage_key": target["key"]}


# ---------------------------------------------------------------------------
# Deadline


def parse_due_source(raw: Any, default: str = "manual") -> str:
    value = str(raw or "").strip().lower()
    return value if value in DUE_SOURCES else default


def normalize_due(value: datetime | None) -> datetime | None:
    """Store naive UTC; a bare date (midnight) means the end of that day."""
    if value is None:
        return None
    if value.tzinfo is not None:
        from datetime import timezone

        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    if (value.hour, value.minute, value.second) == (0, 0, 0):
        value = value.replace(hour=23, minute=59, second=59)
    return value.replace(microsecond=0)


def parse_due_input(raw: Any) -> datetime | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return normalize_due(raw)
    text = str(raw).strip().replace("Z", "+00:00")
    try:
        return normalize_due(datetime.fromisoformat(text))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="due_at must be an ISO date or date-time") from exc


def due_state(due_at: datetime | None, now: datetime, soon_days: int) -> str:
    if due_at is None:
        return ""
    if due_at < now:
        return "overdue"
    if due_at <= now + timedelta(days=soon_days):
        return "soon"
    return "later"


def days_left(due_at: datetime | None, now: datetime) -> int | None:
    if due_at is None:
        return None
    return (due_at.date() - now.date()).days


async def set_due(
    session: AsyncSession,
    signal: Signal,
    due_at: datetime | None,
    *,
    source: str,
    basis: str,
    actor_type: str,
    actor_id: str,
) -> bool:
    """Set or clear the deadline (people and approved proposals). Flushes."""
    before = signal.due_at
    source = parse_due_source(source) if due_at is not None else ""
    basis = (basis or "").strip()[:200] if due_at is not None else ""
    if before == due_at and signal.due_source == source and signal.due_basis == basis:
        return False
    signal.due_at = due_at
    signal.due_source = source
    signal.due_basis = basis
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    _event(
        session,
        signal,
        "ticket_due_changed",
        actor_type,
        actor_id,
        {
            "from": before.isoformat() if before else None,
            "to": due_at.isoformat() if due_at else None,
            "source": source,
            "basis": basis,
        },
    )
    await session.flush()
    from app.services.stage_checkups import refresh_checkup

    await refresh_checkup(session, signal)
    return True


async def propose_due(
    session: AsyncSession,
    signal: Signal,
    tag: SignalTag,
    due_at: datetime,
    *,
    source: str,
    basis: str,
    agent_id: UUID | None,
) -> dict[str, Any]:
    """An agent's deadline is always a proposal. Flushes."""
    from app.services.signal_decisions import create_decision

    await _supersede(session, signal, DUE_PROPOSAL)
    source = parse_due_source(source, default="requested")
    basis = (basis or "").strip()[:200]
    day = due_at.date().isoformat()
    payload = {"signal_id": str(signal.id), "due_at": due_at.isoformat(), "due_source": source, "due_basis": basis}
    decision, _message = await create_decision(
        session,
        signal.tenant_id,
        title=f"#{tag.name}: deadline {day}?",
        summary=(basis or f"Proposed {source} deadline for this ticket.")[:500],
        options=[
            {"id": "approve", "label": f"Set deadline {day}", "action_type": "update_ticket", "payload": payload},
            {"id": "reject", "label": "No deadline"},
        ],
        agent_id=agent_id,
        signal_id=signal.id,
        source_type=DUE_PROPOSAL,
        source_id=str(signal.id),
    )
    _event(
        session,
        signal,
        "ticket_due_proposed",
        "agent" if agent_id else "system",
        str(agent_id or ""),
        {"due_at": due_at.isoformat(), "source": source, "basis": basis, "decision_id": str(decision.id)},
    )
    return {"proposed": True, "decision_id": str(decision.id), "due_at": due_at.isoformat()}


# ---------------------------------------------------------------------------
# Checklist


def checklist_state(signal: Signal) -> dict[str, dict[str, Any]]:
    try:
        data = json.loads(signal.ticket_checklist_json or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {str(k): v for k, v in data.items() if isinstance(v, dict) and v.get("status") in ("done", "proposed")}


def checklist_rows(stages: list[dict[str, Any]], signal: Signal) -> list[dict[str, Any]]:
    state = checklist_state(signal)
    rows: list[dict[str, Any]] = []
    for stage in stages:
        for item in stage.get("checklist") or []:
            mark = state.get(item["key"], {})
            rows.append(
                {
                    **item,
                    "stage_key": stage["key"],
                    "status": mark.get("status") or "open",
                    "by_type": mark.get("by_type"),
                    "by_id": mark.get("by_id"),
                    "at": mark.get("at"),
                    "message_id": mark.get("message_id"),
                }
            )
    return rows


def missing_checklist(stage: dict[str, Any] | None, state: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Required items on ``stage`` that a person has not ticked."""
    if not stage:
        return []
    return [
        dict(item)
        for item in stage.get("checklist") or []
        if item.get("required") and (state.get(item["key"]) or {}).get("status") != "done"
    ]


def guard_checklist_exit(
    stages: list[dict[str, Any]], signal: Signal, current: dict[str, Any] | None, target: dict[str, Any]
) -> None:
    """Moving forward out of a stage that requires its checklist needs every required item."""
    if not current or not current.get("exit_requires_checklist"):
        return
    if _stage_index(stages, target["key"]) <= _stage_index(stages, current["key"]):
        return
    missing = missing_checklist(current, checklist_state(signal))
    if not missing:
        return
    names = ", ".join(item["label"] for item in missing)
    raise HTTPException(
        status_code=400,
        detail={
            "code": "checklist_required",
            "message": f"Tick the required items of {current['name']} first: {names}",
            "stage_key": current["key"],
            "stage_name": current["name"],
            "items": missing,
        },
    )


def apply_checklist(
    session: AsyncSession,
    signal: Signal,
    stages: list[dict[str, Any]],
    changes: dict[str, Any],
    *,
    actor_type: str,
    actor_id: str,
    message_id: str | None = None,
) -> list[dict[str, Any]]:
    """Tick, untick or confirm items. An agent's tick stays ``proposed``."""
    from app.services.tickets import slugify

    known = {item["key"]: item for stage in stages for item in stage.get("checklist") or []}
    changes = {(key if key in known else slugify(str(key))): value for key, value in changes.items()}
    unknown = [key for key in changes if key not in known]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown checklist item: {', '.join(unknown)}")
    state = checklist_state(signal)
    agent = actor_type == "agent"
    now = datetime.utcnow().replace(microsecond=0).isoformat()
    changed: list[dict[str, Any]] = []
    for key, raw in changes.items():
        wanted = str(raw or "").strip().lower()
        if wanted not in ("done", "open"):
            raise HTTPException(status_code=400, detail="Checklist values are 'done' or 'open'")
        current = (state.get(key) or {}).get("status") or "open"
        if wanted == "open":
            if current == "open" or (agent and current == "done"):
                continue
            state.pop(key, None)
            changed.append({"key": key, "label": known[key]["label"], "from": current, "to": "open"})
            continue
        status = "proposed" if agent else "done"
        if current == "done" or current == status:
            continue
        mark: dict[str, Any] = {"status": status, "by_type": actor_type, "by_id": actor_id, "at": now}
        if message_id:
            mark["message_id"] = message_id
        state[key] = mark
        changed.append({"key": key, "label": known[key]["label"], "from": current, "to": status})
    if not changed:
        return []
    signal.ticket_checklist_json = json.dumps(state)
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    _event(session, signal, "ticket_checklist_changed", actor_type, actor_id, {"items": changed})
    return changed


# ---------------------------------------------------------------------------
# Next step


def next_step(
    signal: Signal,
    stages: list[dict[str, Any]],
    *,
    now: datetime,
    soon_days: int,
) -> dict[str, Any] | None:
    """What the card says next: who it waits on, what is missing, how much time is left."""
    if signal.ticket_tag_id is None or signal.ticket_status in ("proposed", ""):
        return None
    stage = next((s for s in stages if s["key"] == signal.stage_key), None)
    finished = signal.ticket_status in ("done", "closed") or (stage or {}).get("kind") == "done"
    state = checklist_state(signal)
    open_items = [
        item for item in (stage or {}).get("checklist") or [] if (state.get(item["key"]) or {}).get("status") != "done"
    ]
    if finished:
        waiting_on = ""
    else:
        waiting_on = parse_waiting_on((stage or {}).get("waiting_on")) or (
            "customer" if signal.turn_kind == "customer" else "us"
        )
    return {
        "waiting_on": waiting_on,
        "missing": [item["label"] for item in open_items if item.get("required")][:5],
        "to_confirm": sum(1 for item in open_items if (state.get(item["key"]) or {}).get("status") == "proposed"),
        "due_at": signal.due_at.isoformat() if signal.due_at else None,
        "due_source": signal.due_source or None,
        "due_state": "" if finished else due_state(signal.due_at, now, soon_days),
        "days_left": None if finished else days_left(signal.due_at, now),
    }


# ---------------------------------------------------------------------------
# Check-up rhythm near a deadline

MIN_CHECKUP_GAP = timedelta(hours=1)


def checkup_next_at(now: datetime, minutes: int, due_at: datetime | None, soon_days: int) -> datetime:
    """The regular rhythm, pulled earlier by deadline marks.

    Marks are the start of the near window, the day before and the deadline
    itself. Past the deadline the ticket is looked at at least daily.
    """
    regular = now + timedelta(minutes=max(1, minutes))
    if due_at is None:
        return regular
    if due_at <= now:
        return min(regular, now + timedelta(days=1))
    marks = [due_at - timedelta(days=soon_days), due_at - timedelta(days=1), due_at]
    upcoming = [m for m in marks if m >= now + MIN_CHECKUP_GAP]
    return min([regular, *upcoming])


# ---------------------------------------------------------------------------
# Payload and learning


async def proposals_payload(session: AsyncSession, signal: Signal) -> list[dict[str, Any]]:
    from app.models.notification import DecisionRequest

    rows = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == signal.tenant_id,
                DecisionRequest.signal_id == signal.id,
                DecisionRequest.source_type.in_(PROPOSAL_SOURCES),
                DecisionRequest.status == "awaiting_human",
            )
        )
    ).scalars()
    out = []
    for row in rows:
        payload = _option_payload(row)
        out.append(
            {
                "decision_id": str(row.id),
                "kind": "stage" if row.source_type == STAGE_PROPOSAL else "due",
                "stage_key": payload.get("stage_key"),
                "due_at": payload.get("due_at"),
                "summary": row.summary,
            }
        )
    return out


async def soon_days_for(session: AsyncSession, tenant_id: UUID) -> int:
    from app.models.auth import Tenant
    from app.services.signal_catalog import signal_policy

    return signal_policy(await session.get(Tenant, tenant_id))["due_soon_days"]


def _feedback(
    session: AsyncSession,
    signal: Signal,
    source_type: str,
    *,
    agreed: bool,
    user_id: UUID | None,
    proposed: dict[str, Any],
    chosen: str = "",
) -> None:
    from app.models.learning import Feedback

    key = str(proposed.get("stage_key") or "due") if source_type == STAGE_PROPOSAL else "due"
    session.add(
        Feedback(
            tenant_id=signal.tenant_id,
            subject_type="signal",
            subject_id=str(signal.id),
            user_id=user_id,
            sentiment="up" if agreed else "down",
            correction_key=f"{source_type}:{signal.ticket_tag_id}:{key}"[:160],
            metadata_json=json.dumps({"kind": source_type, "proposed": proposed, "chosen": chosen}),
        )
    )


async def record_proposal_outcome(
    session: AsyncSession, decision: Any, action: str, *, user_id: UUID | None
) -> None:
    """Learning hook: a confirmed or rejected stage / deadline proposal."""
    if decision.source_type not in PROPOSAL_SOURCES or not decision.signal_id or action not in ("approved", "rejected"):
        return
    signal = await session.get(Signal, decision.signal_id)
    if signal is None:
        return
    proposed = _option_payload(decision)
    _feedback(session, signal, decision.source_type, agreed=action == "approved", user_id=user_id, proposed=proposed)


async def settle_after_person_move(session: AsyncSession, signal: Signal, *, user_id: UUID | None) -> None:
    """A person moved the card: open stage proposals are answered by that move."""
    await _supersede(session, signal, STAGE_PROPOSAL, user_id=user_id, chosen=signal.stage_key or "")


async def settle_after_person_due(session: AsyncSession, signal: Signal, *, user_id: UUID | None) -> None:
    await _supersede(
        session, signal, DUE_PROPOSAL, user_id=user_id, chosen=signal.due_at.isoformat() if signal.due_at else ""
    )


def _event(
    session: AsyncSession, signal: Signal, event_type: str, actor_type: str, actor_id: str, payload: dict[str, Any]
) -> None:
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type=event_type,
            actor_type=actor_type or "system",
            actor_id=actor_id or "",
            payload_json=json.dumps(payload, default=str),
        )
    )
