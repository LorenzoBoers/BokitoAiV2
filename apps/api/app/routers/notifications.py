import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.notification import DecisionRequest, Notification
from app.services.notifications import resolve_decision

router = APIRouter(prefix="/notifications", tags=["notifications"])


class DecisionAction(BaseModel):
    option_id: str


@router.get("")
async def list_notifications(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status_filter: str | None = None,
):
    query = select(Notification).where(Notification.tenant_id == auth.tenant.id)
    if status_filter:
        query = query.where(Notification.status == status_filter)
    result = await session.execute(query.order_by(Notification.created_at.desc()))
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


@router.get("/decisions")
async def list_decisions(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str = "awaiting_human",
):
    result = await session.execute(
        select(DecisionRequest)
        .where(DecisionRequest.tenant_id == auth.tenant.id, DecisionRequest.status == status)
        .order_by(DecisionRequest.created_at.desc())
    )
    return [
        {
            "id": str(d.id),
            "title": d.title,
            "summary": d.summary,
            "status": d.status,
            "options": json.loads(d.options_json or "[]"),
            "source_type": d.source_type,
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
        decision = await resolve_decision(session, auth.tenant.id, decision_id, body.option_id, "approved")
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
