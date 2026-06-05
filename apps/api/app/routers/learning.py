"""LEARNING endpoints."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.learning import (
    apply_heuristic_guardrails,
    compute_eval_scores,
    process_feedback_batch,
    serialize_eval,
    submit_feedback,
)

router = APIRouter(prefix="/learning", tags=["learning"])


class FeedbackBody(BaseModel):
    subject_type: str = "message"
    subject_id: str
    score: int | None = Field(default=None, ge=1, le=5)
    sentiment: str | None = None
    comment: str = ""


@router.post("/feedback")
async def create_feedback(
    body: FeedbackBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await submit_feedback(
        session,
        auth.tenant.id,
        subject_type=body.subject_type,
        subject_id=body.subject_id,
        user_id=auth.user.id,
        score=body.score,
        sentiment=body.sentiment,
        comment=body.comment,
    )
    return {"id": str(row.id), "processed": row.processed}


@router.post("/process")
async def process_feedback(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await process_feedback_batch(session, auth.tenant.id)


@router.post("/eval/compute")
async def compute_eval(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    rows = await compute_eval_scores(session, auth.tenant.id)
    guardrails = await apply_heuristic_guardrails(session, auth.tenant.id)
    return {"items": [serialize_eval(r) for r in rows], "guardrails": guardrails}


@router.get("/eval")
async def list_eval(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    metric: str | None = None,
    limit: int = 20,
):
    from sqlalchemy import select

    from app.models.learning import EvalScore

    stmt = (
        select(EvalScore)
        .where(EvalScore.tenant_id == auth.tenant.id)
        .order_by(EvalScore.created_at.desc())
        .limit(min(limit, 100))
    )
    if metric:
        stmt = stmt.where(EvalScore.metric == metric)
    result = await session.execute(stmt)
    return {"items": [serialize_eval(r) for r in result.scalars().all()]}
