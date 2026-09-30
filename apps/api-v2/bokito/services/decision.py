"""Decisions: one create path, one resolve path.

A decision is a message in the thread plus a resolvable row. Approving a
decision that carries a tool call executes that call with the original
principal, bypassing the policy (the human is the policy now).
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.domain.base import utcnow
from bokito.domain.conversation import (
    Channel,
    Conversation,
    Decision,
    DecisionStatus,
    Direction,
    MessageKind,
)
from bokito.domain.work import Run, RunStatus
from bokito.errors import Conflict, NotFound
from bokito.realtime.broker import publish
from bokito.services import audit
from bokito.services import conversation as conv_svc

GOVERN_EXTERNAL_ID = "govern"


async def govern_conversation(session: AsyncSession, tenant_id: uuid.UUID) -> Conversation:
    """The internal thread where decisions without a customer conversation land."""
    conv, _ = await conv_svc.get_or_create(
        session,
        tenant_id,
        channel=Channel.internal,
        external_id=GOVERN_EXTERNAL_ID,
        subject="Govern",
    )
    return conv


async def create(
    session: AsyncSession,
    conv: Conversation,
    *,
    title: str,
    summary: str = "",
    options: list[dict[str, Any]] | None = None,
    tool_call: dict[str, Any] | None = None,
    requested_by: str = "",
    run_id: uuid.UUID | None = None,
    expires_at=None,
) -> Decision:
    opts = options or [
        {"id": "approve", "label": "Approve", "kind": "primary"},
        {"id": "reject", "label": "Reject", "kind": "secondary"},
    ]
    decision = Decision(
        tenant_id=conv.tenant_id,
        conversation_id=conv.id,
        run_id=run_id,
        title=title[:300],
        summary=summary,
        options=opts,
        tool_call=tool_call,
        requested_by=requested_by,
        expires_at=expires_at,
        created_at=utcnow(),
    )
    session.add(decision)
    await session.flush()
    msg = await conv_svc.append_message(
        session,
        conv,
        kind=MessageKind.decision,
        direction=Direction.internal,
        body=title,
        author_label=requested_by,
        meta={"decision_id": str(decision.id)},
    )
    decision.message_id = msg.id
    conv.unread = True
    await session.flush()
    await publish(conv.tenant_id, "decisions", {"event": "created", "id": str(decision.id)})
    return decision


async def get(session: AsyncSession, tenant_id: uuid.UUID, decision_id: uuid.UUID) -> Decision:
    decision = await session.get(Decision, decision_id)
    if not decision or decision.tenant_id != tenant_id:
        raise NotFound("decision not found", code="decision_not_found")
    return decision


async def list_open(session: AsyncSession, tenant_id: uuid.UUID, limit: int = 50) -> list[Decision]:
    stmt = (
        select(Decision)
        .where(Decision.tenant_id == tenant_id, Decision.status == DecisionStatus.open)
        .order_by(Decision.created_at.desc())
        .limit(limit)
    )
    return list((await session.scalars(stmt)).all())


async def resolve(
    session: AsyncSession,
    decision: Decision,
    *,
    option: str,
    note: str = "",
    user_id: uuid.UUID | None,
    actor: str,
) -> Decision:
    if decision.status != DecisionStatus.open:
        raise Conflict("decision already resolved", code="decision_resolved")
    known = {o.get("id") for o in (decision.options or [])}
    if known and option not in known:
        raise Conflict(f"unknown option {option}", code="unknown_option")

    approved = option not in ("reject", "cancel", "no")
    decision.status = DecisionStatus.approved if approved else DecisionStatus.rejected
    decision.chosen_option = option
    decision.resolution_note = note
    decision.resolved_by_user_id = user_id
    decision.resolved_at = utcnow()

    conv = await session.get(Conversation, decision.conversation_id)
    result: dict[str, Any] | None = None
    run = await session.get(Run, decision.run_id) if decision.run_id else None

    if approved and decision.tool_call:
        from bokito.tools.executor import execute_tool, principal_from_dict

        original = principal_from_dict(
            decision.tool_call.get("principal") or {"tenant_id": str(decision.tenant_id)}
        )
        outcome = await execute_tool(
            session,
            original,
            decision.tool_call["name"],
            decision.tool_call.get("args", {}),
            conversation_id=decision.conversation_id,
            parent_run_id=decision.run_id,
            skip_policy=True,
        )
        result = outcome.to_dict()
        if run:
            run.status = RunStatus.done
            run.output = {"approved": True, "child_run_id": str(outcome.run_id)}
            run.finished_at = utcnow()
    elif run:
        run.status = RunStatus.cancelled if not approved else RunStatus.done
        run.output = {"approved": approved, "option": option}
        run.finished_at = utcnow()

    decision.result = result
    if conv:
        await conv_svc.append_message(
            session,
            conv,
            kind=MessageKind.system,
            body=f"Decision {decision.status.value}: {decision.title}",
            author_user_id=user_id,
            meta={"decision_id": str(decision.id), "option": option, "note": note},
        )
    await audit.record(
        session,
        decision.tenant_id,
        actor=actor,
        trust="operator" if user_id else "system",
        action="decision.resolve",
        target_kind="decision",
        target_id=decision.id,
        conversation_id=decision.conversation_id,
        run_id=decision.run_id,
        payload={"option": option, "status": decision.status.value},
    )
    await session.flush()
    await publish(
        decision.tenant_id,
        "decisions",
        {"event": "resolved", "id": str(decision.id), "status": decision.status.value},
    )
    return decision


async def expire_due(session: AsyncSession) -> int:
    now = utcnow()
    stmt = select(Decision).where(
        Decision.status == DecisionStatus.open,
        Decision.expires_at.is_not(None),
        Decision.expires_at <= now,
    )
    rows = list((await session.scalars(stmt)).all())
    for d in rows:
        d.status = DecisionStatus.expired
        d.resolved_at = now
    await session.flush()
    return len(rows)
