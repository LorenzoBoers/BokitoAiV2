import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.notification import DecisionRequest, Notification
from app.services.notifications import resolve_decision
from app.services.signal_decisions import decision_provenance

router = APIRouter(prefix="/notifications", tags=["notifications"])


class DecisionAction(BaseModel):
    option_id: str
    always_auto: bool = False


@router.get("")
async def list_notifications(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: str | None = None,
    limit: int = Query(50, ge=1, le=100),
):
    # Personal feed: rows addressed to this user plus tenant-wide broadcasts
    # (user_id is NULL). Other members' mentions/assignments stay private.
    query = select(Notification).where(
        Notification.tenant_id == auth.tenant.id,
        (Notification.user_id == auth.user.id) | (Notification.user_id.is_(None)),  # type: ignore[union-attr]
    )
    if status_filter:
        query = query.where(Notification.status == status_filter)
    # Unread first, then newest — keeps the feed useful under the hard cap.
    result = await session.execute(
        query.order_by(
            (Notification.status != "unread").asc(),
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
            "payload": json.loads(n.payload_json or "{}"),
            "created_at": n.created_at.isoformat(),
        }
        for n in result.scalars().all()
    ]


@router.post("/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(Notification).where(
            Notification.id == notification_id, Notification.tenant_id == auth.tenant.id
        )
    )
    notification = result.scalar_one_or_none()
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    notification.status = "read"
    session.add(notification)
    await session.commit()
    return {"id": str(notification.id), "status": notification.status}


@router.post("/read-all")
async def mark_all_notifications_read(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(Notification).where(
            Notification.tenant_id == auth.tenant.id,
            Notification.status == "unread",
            (Notification.user_id == auth.user.id) | (Notification.user_id.is_(None)),  # type: ignore[union-attr]
        )
    )
    rows = result.scalars().all()
    for notification in rows:
        notification.status = "read"
        session.add(notification)
    await session.commit()
    return {"updated": len(rows)}


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
            user_id=auth.user.id, always_auto=body.always_auto or body.option_id == "always_auto",
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
