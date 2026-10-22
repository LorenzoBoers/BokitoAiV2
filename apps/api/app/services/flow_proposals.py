"""Proposals from the scorecard, made by the department lead in its room.

From the last 30 days, per flow of a department:

- **autonomy:** enough clean outcomes (no corrections, no rejected decisions) on
  a flow that does not run autonomous yet propose Autonomous; many corrections
  on an autonomous flow propose a step back to Assisted;
- **instructions:** draft corrections on the flow's label (``reply:{label}``)
  that keep coming back propose a line in the flow's instructions with the
  replies the team sent instead;
- **capabilities:** a tool the team keeps rejecting on the flow's tickets is
  taken out of the capabilities, or gets an "ask first" line when the flow
  names no capabilities;

and per cluster of work no label covers (the signal backlog), a **new flow**
with that label for the department of the agent that kept seeing it.

Each proposal is a Govern change (mode ask) with its decision in the
department room and a message from the department lead that explains it. The
change carries ``proposed_by_id = "learning:{kind}"`` and the lead as
``agent_id``, so acceptance counts on the lead's scorecard. One proposal per
subject in 30 days, whatever the answer was; a rejection is also kept as
``Feedback``. The threshold for clean outcomes is the workspace setting
``learning_autonomy_threshold`` (default 20).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.orchestra import Workstream
from app.models.platform_change import PlatformChange
from app.models.signal import SignalEvent

WINDOW_DAYS = 30
COOLDOWN_DAYS = 30
DEFAULT_THRESHOLD = 20
STEP_BACK_MIN_VOLUME = 10
STEP_BACK_CORRECTED_PCT = 30.0
INSTRUCTION_MIN_CORRECTIONS = 3
CAPABILITY_MIN_REJECTIONS = 3
EXAMPLE_CHARS = 240
LEARNING_PREFIX = "learning:"
PROPOSER_METRIC = "proposals_accepted_pct"


def learning_kind(change: PlatformChange) -> str:
    raw = change.proposed_by_id or ""
    return raw[len(LEARNING_PREFIX):] if raw.startswith(LEARNING_PREFIX) else ""


def record_rejected_proposal(session: AsyncSession, change: PlatformChange, user_id: UUID | None) -> None:
    """A rejected learning proposal is feedback on the lead that made it."""
    kind = learning_kind(change)
    if not kind:
        return
    from app.models.learning import Feedback

    try:
        key = str(json.loads(change.after_json or "{}").get("learning_key") or "")
    except json.JSONDecodeError:
        key = ""
    session.add(
        Feedback(
            tenant_id=change.tenant_id,
            subject_type="learning_proposal",
            subject_id=str(change.id),
            user_id=user_id,
            sentiment="down",
            comment=change.summary[:2000],
            correction_key=f"{LEARNING_PREFIX}{key or kind}"[:160],
            metadata_json=json.dumps({"kind": kind, "agent_id": str(change.agent_id) if change.agent_id else None}),
        )
    )


async def _outcomes_by_flow(session: AsyncSession, tenant_id: UUID, since: datetime) -> dict[str, list[dict[str, Any]]]:
    rows = (
        await session.execute(
            select(SignalEvent.payload_json).where(
                SignalEvent.tenant_id == tenant_id,
                SignalEvent.event_type == "outcome",
                SignalEvent.created_at >= since,
            )
        )
    ).scalars().all()
    out: dict[str, list[dict[str, Any]]] = {}
    for raw in rows:
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict) and data.get("flow_id"):
            out.setdefault(str(data["flow_id"]), []).append(data)
    return out


async def _recently_proposed(session: AsyncSession, tenant_id: UUID, key: str, now: datetime) -> bool:
    row = (
        await session.execute(
            select(PlatformChange.id).where(
                PlatformChange.tenant_id == tenant_id,
                PlatformChange.proposed_by_id.startswith(LEARNING_PREFIX),
                PlatformChange.created_at >= now - timedelta(days=COOLDOWN_DAYS),
                PlatformChange.after_json.contains(json.dumps({"learning_key": key})[1:-1]),
            )
        )
    ).first()
    return row is not None


def _judge(items: list[dict[str, Any]], mode: str, threshold: int) -> tuple[str, str] | None:
    volume = len(items)
    clean = sum(1 for i in items if not i.get("corrections") and not i.get("rejected_decisions"))
    corrected = sum(1 for i in items if i.get("corrections"))
    corrected_pct = corrected / volume * 100 if volume else 0.0
    if mode != "autonomous" and clean >= threshold and corrected_pct < 10:
        return "autonomous", (
            f"{clean} of the last {volume} tickets closed without a correction or a rejected decision "
            f"in {WINDOW_DAYS} days. I propose to let this flow run autonomous."
        )
    if mode == "autonomous" and volume >= STEP_BACK_MIN_VOLUME and corrected_pct >= STEP_BACK_CORRECTED_PCT:
        return "assisted", (
            f"{corrected} of the last {volume} tickets needed a correction ({round(corrected_pct)}%). "
            "I propose to go back to assisted until the approach is right again."
        )
    return None


async def _flow_label(session: AsyncSession, ws: Workstream):
    from app.models.signal import SignalTag

    return (await session.execute(select(SignalTag).where(SignalTag.workstream_id == ws.id))).scalars().first()


async def _instruction_proposal(
    session: AsyncSession, tenant_id: UUID, ws: Workstream, label_name: str, since: datetime
) -> tuple[dict[str, Any], str] | None:
    from app.models.learning import Feedback

    rows = (
        await session.execute(
            select(Feedback.metadata_json)
            .where(
                Feedback.tenant_id == tenant_id,
                Feedback.subject_type == "draft_edit",
                Feedback.correction_key == f"reply:{label_name}"[:160],
                Feedback.created_at >= since,
            )
            .order_by(Feedback.created_at.desc())
        )
    ).scalars().all()
    if len(rows) < INSTRUCTION_MIN_CORRECTIONS:
        return None
    examples: list[str] = []
    for raw in rows[:INSTRUCTION_MIN_CORRECTIONS]:
        try:
            sent = str(json.loads(raw or "{}").get("sent") or "").strip()
        except json.JSONDecodeError:
            sent = ""
        if sent:
            examples.append(" ".join(sent.split())[:EXAMPLE_CHARS])
    if not examples:
        return None
    guidance = "Write replies the way the team corrected recent drafts, for example:\n" + "\n".join(
        f"- {line}" for line in examples
    )
    instructions = f"{ws.instructions.rstrip()}\n\n{guidance}".strip()
    reason = (
        f"The team corrected {len(rows)} of my drafts on #{label_name} in {WINDOW_DAYS} days. "
        "I propose to add how they wrote it to the instructions of this flow."
    )
    return {"instructions": instructions}, reason


def _approved_tool(options_json: str) -> str:
    from app.services.decision_actions import SOFT_ACTIONS

    try:
        options = json.loads(options_json or "[]")
    except json.JSONDecodeError:
        return ""
    for opt in options if isinstance(options, list) else []:
        name = str((opt or {}).get("action_type") or "") if isinstance(opt, dict) else ""
        if name and name not in SOFT_ACTIONS:
            return name
    return ""


async def _capability_proposal(
    session: AsyncSession, tenant_id: UUID, ws: Workstream, label_id: UUID, since: datetime
) -> tuple[dict[str, Any], str, str] | None:
    from app.models.notification import DecisionRequest
    from app.models.signal import Signal
    from app.services.workstreams import recipe_of

    rows = (
        await session.execute(
            select(DecisionRequest.options_json)
            .join(Signal, Signal.id == DecisionRequest.signal_id)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "rejected",
                DecisionRequest.created_at >= since,
                Signal.ticket_tag_id == label_id,
            )
        )
    ).scalars().all()
    counts: dict[str, int] = {}
    for raw in rows:
        tool = _approved_tool(raw)
        if tool:
            counts[tool] = counts.get(tool, 0) + 1
    if not counts:
        return None
    tool, n = max(counts.items(), key=lambda item: item[1])
    if n < CAPABILITY_MIN_REJECTIONS:
        return None
    caps = recipe_of(ws)["capabilities"]
    if tool in caps:
        reason = (
            f"The team rejected {tool} {n} times on this flow in {WINDOW_DAYS} days. "
            "I propose to take it out of the capabilities of this flow."
        )
        return {"capabilities": [c for c in caps if c != tool]}, reason, tool
    line = f"Ask before using {tool}: the team rejected it {n} times on this flow."
    reason = (
        f"The team rejected {tool} {n} times on this flow in {WINDOW_DAYS} days. "
        "I propose an instruction to ask first."
    )
    return {"instructions": f"{ws.instructions.rstrip()}\n\n{line}".strip()}, reason, tool


async def _propose(
    session: AsyncSession,
    tenant: Any,
    dept: Any,
    *,
    kind: str,
    key: str,
    resource_type: str,
    change_kind: str,
    resource_id: str,
    before: dict[str, Any],
    after: dict[str, Any],
    summary: str,
    message: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    from app.services.chat_runtime import post_message
    from app.services.department_access import department_leads
    from app.services.platform_changes import propose_platform_change
    from app.services.teams import get_or_create_team_room

    lead = (await department_leads(session, tenant.id, dept.id))["lead_agent_id"]
    room = await get_or_create_team_room(session, tenant.id, dept)
    await session.flush()
    change, _meta = await propose_platform_change(
        session,
        tenant,
        resource_type=resource_type,
        change_kind=change_kind,
        resource_id=resource_id,
        before=before,
        after={**after, "learning_key": key},
        summary=summary,
        mode="ask",
        signal_id=room.id,
    )
    change.proposed_by_id = f"{LEARNING_PREFIX}{kind}"
    change.agent_id = lead
    session.add(change)
    if lead is not None:
        await post_message(
            session,
            room,
            content=message,
            role="assistant",
            trust="system",
            author_agent_id=lead,
            metadata={"learning_proposal": True, "kind": kind, "change_id": str(change.id), **metadata},
        )
    return {"kind": kind, "change_id": str(change.id), "signal_id": str(room.id), **metadata}


async def _department_for_agents(session: AsyncSession, tenant_id: UUID, agents: dict[str, int]):
    """The department of the agent that saw a cluster most; one department as fallback."""
    from app.models.team import Department, DepartmentMember, is_root_department

    depts = [
        d
        for d in (
            await session.execute(
                select(Department).where(Department.tenant_id == tenant_id, Department.deleted_at.is_(None))
            )
        ).scalars().all()
        if not is_root_department(d)
    ]
    by_id = {d.id: d for d in depts}
    for agent_raw, _n in sorted(agents.items(), key=lambda item: -int(item[1] or 0)):
        try:
            agent_id = UUID(agent_raw)
        except ValueError:
            continue
        rows = (
            await session.execute(
                select(DepartmentMember.department_id, DepartmentMember.duty).where(
                    DepartmentMember.tenant_id == tenant_id,
                    DepartmentMember.member_kind == "agent",
                    DepartmentMember.agent_id == agent_id,
                )
            )
        ).all()
        ranked = sorted(rows, key=lambda row: 0 if row[1] == "primary" else 1)
        for dept_id, _duty in ranked:
            if dept_id in by_id:
                return by_id[dept_id]
    return depts[0] if len(depts) == 1 else None


async def _new_flow_proposals(session: AsyncSession, tenant: Any, now: datetime) -> list[dict[str, Any]]:
    from app.services.signal_catalog import read_backlog

    made: list[dict[str, Any]] = []
    for entry in read_backlog(tenant):
        if not entry["ready"]:
            continue
        key = f"new_flow:{entry['key']}"
        if await _recently_proposed(session, tenant.id, key, now):
            continue
        dept = await _department_for_agents(session, tenant.id, entry.get("agents") or {})
        if dept is None:
            continue
        examples = "; ".join(entry["examples"][:2])
        message = (
            f"{entry['count']} conversations about {entry['name']} had no label that fits. "
            f"I propose a flow with the label #{entry['key']} for {dept.name}."
            + (f" For example: {examples}" if examples else "")
        )
        made.append(
            await _propose(
                session,
                tenant,
                dept,
                kind="new_flow",
                key=key,
                resource_type="category",
                change_kind="create",
                resource_id="",
                before={},
                after={
                    "name": entry["key"],
                    "description": entry["sentence"],
                    "department_id": str(dept.id),
                    "backlog_key": entry["key"],
                },
                summary=f"New flow #{entry['key']} for {dept.name}",
                message=message,
                metadata={"backlog_key": entry["key"]},
            )
        )
    return made


async def accepted_improvements(session: AsyncSession, tenant_id: UUID, *, days: int = 30) -> list[dict[str, Any]]:
    """Accepted proposals with the autonomous share of their flow then and now (Today)."""
    from app.models.learning import EvalScore
    from app.services.learning import LABEL_SCORECARD

    since = utcnow() - timedelta(days=days)
    changes = (
        await session.execute(
            select(PlatformChange)
            .where(
                PlatformChange.tenant_id == tenant_id,
                PlatformChange.resource_type == "workstream",
                PlatformChange.proposed_by_type == "system",
                PlatformChange.status == "accepted",
                PlatformChange.resolved_at >= since,
            )
            .order_by(PlatformChange.resolved_at.desc())
            .limit(10)
        )
    ).scalars().all()
    out: list[dict[str, Any]] = []
    for change in changes:
        try:
            after = json.loads(change.after_json or "{}")
        except json.JSONDecodeError:
            continue
        if "autonomy" not in after:
            continue
        ws = await session.get(Workstream, UUID(change.resource_id)) if change.resource_id else None
        if ws is None:
            continue
        tag = await _flow_label(session, ws)
        cards = (
            await session.execute(
                select(EvalScore)
                .where(
                    EvalScore.tenant_id == tenant_id,
                    EvalScore.scope == "label",
                    EvalScore.metric == LABEL_SCORECARD,
                    EvalScore.scope_id == str(tag.id),
                )
                .order_by(EvalScore.created_at.asc())
            )
        ).scalars().all() if tag else []
        before = next((c for c in reversed(cards) if c.created_at <= change.resolved_at), None)
        now = cards[-1] if cards else None
        out.append({
            "change_id": str(change.id),
            "workstream_id": str(ws.id),
            "flow": ws.name,
            "autonomy": after["autonomy"],
            "accepted_at": change.resolved_at.isoformat() + "Z" if change.resolved_at else None,
            "autonomous_pct_before": round(before.value, 1) if before else None,
            "autonomous_pct_now": round(now.value, 1) if now and now is not before else None,
        })
    return out


async def open_proposals(session: AsyncSession, tenant_id: UUID, department_id: UUID) -> list[dict[str, Any]]:
    """Learning proposals in the department room that still wait for an answer."""
    from app.models.notification import DecisionRequest
    from app.models.signal import Signal

    rows = (
        await session.execute(
            select(PlatformChange, DecisionRequest.id, Signal.id)
            .join(DecisionRequest, DecisionRequest.platform_change_id == PlatformChange.id)
            .join(Signal, Signal.id == DecisionRequest.signal_id)
            .where(
                PlatformChange.tenant_id == tenant_id,
                PlatformChange.proposed_by_id.startswith(LEARNING_PREFIX),
                PlatformChange.status.in_(("draft", "pending_review")),
                Signal.source == "department",
                Signal.assignee_kind == "department",
                Signal.assignee_id == department_id,
            )
            .order_by(PlatformChange.created_at.desc())
            .limit(10)
        )
    ).all()
    return [
        {
            "change_id": str(change.id),
            "decision_id": str(decision_id),
            "kind": learning_kind(change),
            "summary": change.summary,
            "signal_id": str(room_id),
            "created_at": change.created_at.isoformat() + "Z",
        }
        for change, decision_id, room_id in rows
    ]


async def proposal_history(
    session: AsyncSession, tenant_id: UUID, department_id: UUID, *, days: int = 60
) -> list[dict[str, Any]]:
    """Resolved learning proposals made in the department room: what the lead learned and how it landed."""
    from app.models.notification import DecisionRequest
    from app.models.signal import Signal

    rows = (
        await session.execute(
            select(PlatformChange)
            .join(DecisionRequest, DecisionRequest.platform_change_id == PlatformChange.id)
            .join(Signal, Signal.id == DecisionRequest.signal_id)
            .where(
                PlatformChange.tenant_id == tenant_id,
                PlatformChange.proposed_by_id.startswith(LEARNING_PREFIX),
                PlatformChange.status.in_(("accepted", "applied", "rejected")),
                PlatformChange.created_at >= utcnow() - timedelta(days=days),
                Signal.source == "department",
                Signal.assignee_kind == "department",
                Signal.assignee_id == department_id,
            )
            .order_by(PlatformChange.created_at.desc())
            .limit(20)
        )
    ).scalars().all()
    return [
        {
            "change_id": str(change.id),
            "kind": learning_kind(change),
            "summary": change.summary,
            "status": "rejected" if change.status == "rejected" else "accepted",
            "resolved_at": change.resolved_at.isoformat() + "Z" if change.resolved_at else None,
        }
        for change in rows
    ]


async def score_proposers(session: AsyncSession, tenant_id: UUID, *, days: int = 90) -> list[Any]:
    """Per lead agent: the share of its resolved learning proposals that were accepted."""
    from app.models.learning import EvalScore

    since = utcnow() - timedelta(days=days)
    rows = (
        await session.execute(
            select(PlatformChange.agent_id, PlatformChange.status, func.count(PlatformChange.id))
            .where(
                PlatformChange.tenant_id == tenant_id,
                PlatformChange.proposed_by_id.startswith(LEARNING_PREFIX),
                PlatformChange.agent_id.is_not(None),
                PlatformChange.status.in_(("accepted", "rejected")),
                PlatformChange.resolved_at >= since,
            )
            .group_by(PlatformChange.agent_id, PlatformChange.status)
        )
    ).all()
    tally: dict[UUID, dict[str, int]] = {}
    for agent_id, status, n in rows:
        tally.setdefault(agent_id, {"accepted": 0, "rejected": 0})[status] = int(n or 0)
    scores = []
    for agent_id, counts in tally.items():
        total = counts["accepted"] + counts["rejected"]
        row = EvalScore(
            tenant_id=tenant_id,
            scope="agent",
            scope_id=str(agent_id),
            metric=PROPOSER_METRIC,
            value=round(counts["accepted"] / total * 100, 1),
            sample_size=total,
            details_json=json.dumps(counts),
        )
        session.add(row)
        scores.append(row)
    return scores


async def propose_from_scorecards(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    from app.dependencies import tenant_settings
    from app.models.auth import Tenant
    from app.models.team import Department
    from app.services.ai_handling import workspace_mode

    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        return []
    try:
        threshold = max(1, int(tenant_settings(tenant).get("learning_autonomy_threshold") or DEFAULT_THRESHOLD))
    except (TypeError, ValueError):
        threshold = DEFAULT_THRESHOLD
    now = utcnow()
    since = now - timedelta(days=WINDOW_DAYS)
    outcomes = await _outcomes_by_flow(session, tenant_id, since)
    base = workspace_mode(tenant)
    made: list[dict[str, Any]] = []
    flows = (
        await session.execute(
            select(Workstream).where(
                Workstream.tenant_id == tenant_id,
                Workstream.deleted_at.is_(None),
                Workstream.department_id.is_not(None),
            )
        )
    ).scalars().all()
    for ws in flows:
        dept = await session.get(Department, ws.department_id)
        if dept is None or dept.deleted_at is not None:
            continue
        ref = {"workstream_id": str(ws.id)}
        verdict = _judge(outcomes.get(str(ws.id), []), ws.autonomy or base, threshold)
        if verdict is not None:
            target, reason = verdict
            key = f"{ws.id}:autonomy:{target}"
            if not await _recently_proposed(session, tenant_id, key, now):
                made.append(
                    await _propose(
                        session, tenant, dept,
                        kind="autonomy", key=key,
                        resource_type="workstream", change_kind="update", resource_id=str(ws.id),
                        before={**ref, "autonomy": ws.autonomy or ""},
                        after={**ref, "autonomy": target},
                        summary=f"Autonomy of flow {ws.name}: {target}",
                        message=f"Flow {ws.name}: {reason}",
                        metadata={**ref, "target": target},
                    )
                )
        tag = await _flow_label(session, ws)
        if tag is None:
            continue
        key = f"{ws.id}:instructions"
        if not await _recently_proposed(session, tenant_id, key, now):
            proposal = await _instruction_proposal(session, tenant_id, ws, tag.name, since)
            if proposal is not None:
                after, reason = proposal
                made.append(
                    await _propose(
                        session, tenant, dept,
                        kind="instructions", key=key,
                        resource_type="workstream", change_kind="update", resource_id=str(ws.id),
                        before={**ref, "instructions": ws.instructions},
                        after={**ref, **after},
                        summary=f"Instructions of flow {ws.name}",
                        message=f"Flow {ws.name}: {reason}",
                        metadata=ref,
                    )
                )
        proposal = await _capability_proposal(session, tenant_id, ws, tag.id, since)
        if proposal is not None:
            after, reason, tool = proposal
            key = f"{ws.id}:capability:{tool}"
            if not await _recently_proposed(session, tenant_id, key, now):
                from app.services.workstreams import recipe_of

                made.append(
                    await _propose(
                        session, tenant, dept,
                        kind="capabilities", key=key,
                        resource_type="workstream", change_kind="update", resource_id=str(ws.id),
                        before={**ref, "capabilities": recipe_of(ws)["capabilities"], "instructions": ws.instructions},
                        after={**ref, **after},
                        summary=f"Capabilities of flow {ws.name}: {tool}",
                        message=f"Flow {ws.name}: {reason}",
                        metadata={**ref, "tool": tool},
                    )
                )
    made.extend(await _new_flow_proposals(session, tenant, now))
    if made:
        await session.commit()
    return made
