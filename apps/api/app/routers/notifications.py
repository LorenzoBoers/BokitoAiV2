import json
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.notification import DecisionRequest, Notification
from app.services.notifications import resolve_decision
from app.services.signal_decisions import decision_provenance

router = APIRouter(prefix="/notifications", tags=["notifications"])


class DecisionAction(BaseModel):
    option_id: str


def _mine(auth: AuthContext):
    # Rows addressed to this user plus tenant-wide broadcasts (user_id NULL).
    return (
        Notification.tenant_id == auth.tenant.id,
        (Notification.user_id == auth.user.id) | (Notification.user_id.is_(None)),  # type: ignore[union-attr]
    )


class NotificationItem(BaseModel):
    id: str
    kind: str
    title: str
    body: str
    status: str
    tier: int
    payload: dict[str, Any]
    created_at: str


class NotificationSummary(BaseModel):
    unread: int
    for_you: int


@router.get("", response_model=list[NotificationItem])
async def list_notifications(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    """The bell: system notices only (tier 1-3).

    Conversation items (assignments, mentions, decisions, handoffs) live in
    For you and are read by opening the conversation, so they never appear
    here twice.
    """
    query = select(Notification).where(*_mine(auth), Notification.signal_id.is_(None))
    if status_filter:
        query = query.where(Notification.status == status_filter)
    result = await session.execute(
        query.order_by(
            (Notification.status != "unread").asc(),
            Notification.tier.asc(),
            Notification.created_at.desc(),
        ).limit(limit)
    )
    return [
        {
            "id": str(n.id),
            "kind": n.kind,
            "title": n.title,
            "body": n.body,
            "status": n.status,
            "tier": n.tier or 2,
            "payload": json.loads(n.payload_json or "{}"),
            "created_at": n.created_at.isoformat(),
        }
        for n in result.scalars().all()
    ]


@router.get("/summary", response_model=NotificationSummary)
async def notification_summary(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Unread system notices for the bell badge, and open conversations in For you."""
    from app.models.signal import Signal
    from app.services.ownership import for_you_clause

    unread = (
        await session.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                *_mine(auth),
                Notification.signal_id.is_(None),
                Notification.status == "unread",
                Notification.tier < 3,
            )
        )
    ).scalar_one()
    for_you = (
        await session.execute(
            select(func.count())
            .select_from(Signal)
            .where(
                Signal.tenant_id == auth.tenant.id,
                Signal.status == "open",
                await for_you_clause(session, auth.tenant.id, auth.user.id),
            )
        )
    ).scalar_one()
    return {"unread": int(unread or 0), "for_you": int(for_you or 0)}


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Mark one notice read; a conversation notice reads every notice of that conversation for you."""
    from app.services.notify import mark_conversation_read

    result = await session.execute(
        select(Notification).where(Notification.id == notification_id, *_mine(auth))
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.status = "read"
    session.add(notification)
    if notification.signal_id:
        await mark_conversation_read(session, auth.tenant.id, auth.user.id, notification.signal_id)
    await session.commit()
    return {"id": str(notification.id), "status": notification.status}


@router.post("/read-all")
async def mark_all_notifications_read(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Mark every system notice in the bell read (For you items stay)."""
    result = await session.execute(
        update(Notification)
        .where(*_mine(auth), Notification.signal_id.is_(None), Notification.status == "unread")
        .values(status="read")
    )
    await session.commit()
    return {"updated": int(result.rowcount or 0)}


@router.get("/decisions")
async def list_decisions(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str = "awaiting_human",
    limit: int = Query(50, ge=1, le=100),
):
    """Thin wrapper over DecisionRequest for mobile.

    Prefer Messages hub filter ``needs_decision`` / inline thread cards.
    Only returns decisions attached to a signal (inline-in-thread model).
    """
    result = await session.execute(
        select(DecisionRequest)
        .where(
            DecisionRequest.tenant_id == auth.tenant.id,
            DecisionRequest.status == status,
            DecisionRequest.signal_id.isnot(None),
        )
        .order_by(DecisionRequest.created_at.desc())
        .limit(limit)
    )
    return [
        {
            "id": str(d.id),
            "title": d.title,
            "summary": d.summary,
            "status": d.status,
            "options": json.loads(d.options_json or "[]"),
            "source_type": d.source_type,
            "signal_id": str(d.signal_id) if d.signal_id else None,
            "message_id": str(d.message_id) if d.message_id else None,
            "source": decision_provenance(d),
            "created_at": d.created_at.isoformat(),
        }
        for d in result.scalars().all()
    ]


@router.post("/decisions/{decision_id}/approve")
async def approve_decision(
    decision_id: UUID,
    body: DecisionAction,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        decision = await resolve_decision(
            session, auth.tenant.id, decision_id, body.option_id, "approved",
            user_id=auth.user.id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"id": str(decision.id), "status": decision.status, "chosen_option_id": decision.chosen_option_id}


@router.post("/decisions/{decision_id}/reject")
async def reject_decision(
    decision_id: UUID,
    body: DecisionAction,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        decision = await resolve_decision(session, auth.tenant.id, decision_id, body.option_id, "rejected")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"id": str(decision.id), "status": decision.status}


class DecisionLearnBody(BaseModel):
    choice: str  # allow | ask | unsure


class DecisionLearnResult(BaseModel):
    status: str
    count: int | None = None
    change_id: str | None = None
    rule: dict[str, Any] | None = None


@router.post("/decisions/{decision_id}/learn", response_model=DecisionLearnResult)
async def learn_from_decision(
    decision_id: UUID,
    body: DecisionLearnBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Teach the agent from a decision card.

    ``allow`` (you may do this yourself from now on) and ``ask`` (always ask)
    propose a rule as an inline Govern decision; a rule to Autonomous needs an
    owner or admin to confirm. ``unsure`` collects the example; after a few the
    agent proposes a rule based on how the team decided.
    """
    from app.services.agent_rules import learn_from_decision as learn

    decision = await session.get(DecisionRequest, decision_id)
    if decision is None or decision.tenant_id != auth.tenant.id:
        raise HTTPException(status_code=404, detail="Decision not found")
    result = await learn(session, auth.tenant, decision, body.choice, user_id=auth.user.id)
    return {
        "status": str(result.get("status") or ""),
        "count": result.get("count"),
        "change_id": result.get("change_id"),
        "rule": result.get("rule"),
    }


@router.post("/decisions/{decision_id}/defer")
async def defer_decision(
    decision_id: UUID,
    body: DecisionAction,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        decision = await resolve_decision(session, auth.tenant.id, decision_id, body.option_id, "deferred")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"id": str(decision.id), "status": decision.status}
