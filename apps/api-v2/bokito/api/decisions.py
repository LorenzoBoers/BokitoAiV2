"""Decisions: list open ones, resolve through the single path."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from bokito.api.schemas import DecisionOut
from bokito.deps import DbSession, Operator
from bokito.services import decision as decision_svc

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get("", response_model=list[DecisionOut], summary="Open decisions")
async def list_decisions(
    session: DbSession, principal: Operator, limit: int = Query(default=50, le=200)
) -> list[DecisionOut]:
    rows = await decision_svc.list_open(session, principal.tenant_id, limit=limit)
    return [DecisionOut.model_validate(d) for d in rows]


@router.get("/{decision_id}", response_model=DecisionOut, summary="Decision detail")
async def get_decision(
    decision_id: uuid.UUID, session: DbSession, principal: Operator
) -> DecisionOut:
    return DecisionOut.model_validate(
        await decision_svc.get(session, principal.tenant_id, decision_id)
    )


class ResolveIn(BaseModel):
    option: str = Field(min_length=1, max_length=120)
    note: str = Field(default="", max_length=4000)


@router.post("/{decision_id}/resolve", response_model=DecisionOut, summary="Resolve a decision")
async def resolve(
    decision_id: uuid.UUID, body: ResolveIn, session: DbSession, principal: Operator
) -> DecisionOut:
    decision = await decision_svc.get(session, principal.tenant_id, decision_id)
    await decision_svc.resolve(
        session,
        decision,
        option=body.option,
        note=body.note,
        user_id=principal.user_id,
        actor=principal.actor,
    )
    await session.commit()
    return DecisionOut.model_validate(decision)
