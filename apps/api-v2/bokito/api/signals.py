"""Signal types and signals: typed recognition on conversations."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from bokito.api.schemas import SignalOut, SignalTypeOut
from bokito.deps import DbSession, Operator
from bokito.domain.base import utcnow
from bokito.domain.identity import Posture, Role
from bokito.domain.orient import Signal, SignalStatus, SignalType
from bokito.errors import Conflict, NotFound
from bokito.services.identity import slugify

router = APIRouter(prefix="/signals", tags=["signals"])


class SignalTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = None
    description: str = ""
    color: str = ""
    fields: list[dict[str, Any]] = Field(default_factory=list)
    recognition: dict[str, Any] = Field(default_factory=dict)
    autonomy_cap: Posture | None = None
    playbook_id: uuid.UUID | None = None
    enabled: bool = True


@router.get("/types", response_model=list[SignalTypeOut], summary="Signal types")
async def list_types(session: DbSession, principal: Operator) -> list[SignalTypeOut]:
    rows = (
        await session.scalars(
            select(SignalType)
            .where(SignalType.tenant_id == principal.tenant_id)
            .order_by(SignalType.name)
        )
    ).all()
    return [SignalTypeOut.model_validate(t) for t in rows]


@router.post(
    "/types", response_model=SignalTypeOut, status_code=201, summary="Create a signal type"
)
async def create_type(body: SignalTypeIn, session: DbSession, principal: Operator) -> SignalTypeOut:
    principal.require_role(Role.admin)
    slug = slugify(body.slug or body.name)
    exists = await session.scalar(
        select(SignalType.id).where(
            SignalType.tenant_id == principal.tenant_id, SignalType.slug == slug
        )
    )
    if exists:
        raise Conflict(f"signal type {slug} exists", code="signal_type_exists")
    st = SignalType(tenant_id=principal.tenant_id, slug=slug, **body.model_dump(exclude={"slug"}))
    session.add(st)
    await session.commit()
    return SignalTypeOut.model_validate(st)


@router.patch("/types/{type_id}", response_model=SignalTypeOut, summary="Update a signal type")
async def update_type(
    type_id: uuid.UUID, body: SignalTypeIn, session: DbSession, principal: Operator
) -> SignalTypeOut:
    principal.require_role(Role.admin)
    st = await session.get(SignalType, type_id)
    if not st or st.tenant_id != principal.tenant_id:
        raise NotFound("signal type not found", code="signal_type_not_found")
    for key, value in body.model_dump(exclude={"slug"}).items():
        setattr(st, key, value)
    await session.commit()
    return SignalTypeOut.model_validate(st)


@router.get("", response_model=list[SignalOut], summary="Signals")
async def list_signals(
    session: DbSession,
    principal: Operator,
    type_id: uuid.UUID | None = None,
    status: SignalStatus | None = None,
    limit: int = Query(default=100, le=500),
) -> list[SignalOut]:
    stmt = select(Signal).where(Signal.tenant_id == principal.tenant_id)
    if type_id:
        stmt = stmt.where(Signal.type_id == type_id)
    if status:
        stmt = stmt.where(Signal.status == status)
    rows = (await session.scalars(stmt.order_by(Signal.created_at.desc()).limit(limit))).all()
    return [SignalOut.model_validate(s) for s in rows]


class SignalPatch(BaseModel):
    status: SignalStatus | None = None
    title: str | None = None
    fields: dict[str, Any] | None = None


@router.patch("/{signal_id}", response_model=SignalOut, summary="Update a signal")
async def update_signal(
    signal_id: uuid.UUID, body: SignalPatch, session: DbSession, principal: Operator
) -> SignalOut:
    signal = await session.get(Signal, signal_id)
    if not signal or signal.tenant_id != principal.tenant_id:
        raise NotFound("signal not found", code="signal_not_found")
    if body.status is not None:
        signal.status = body.status
        signal.done_at = utcnow() if body.status == SignalStatus.done else None
    if body.title is not None:
        signal.title = body.title[:300]
    if body.fields is not None:
        signal.fields = {**(signal.fields or {}), **body.fields}
    await session.commit()
    return SignalOut.model_validate(signal)
