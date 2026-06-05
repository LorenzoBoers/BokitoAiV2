"""Unified SENSING endpoints (Signal model)."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.interpretation import triage_signal
from app.services.signals import (
    create_inbound_signal,
    get_signal_detail,
    list_signals,
    serialize_signal,
)

router = APIRouter(prefix="/signals", tags=["signals"])


class InboundSignalBody(BaseModel):
    channel: str = "email"
    source: str = "mock"
    subject: str = ""
    body_text: str
    contact_email: str = ""
    contact_name: str = ""
    external_id: str = ""


@router.get("")
async def list_signal_threads(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    status: str | None = None,
    channel: str | None = None,
    priority: str | None = None,
    limit: int = 50,
    offset: int = 0,
):
    rows = await list_signals(
        session,
        auth.tenant.id,
        status=status,
        channel=channel,
        priority=priority,
        limit=limit,
        offset=offset,
    )
    return {"items": [serialize_signal(r) for r in rows]}


@router.get("/{signal_id}")
async def get_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await get_signal_detail(session, auth.tenant.id, signal_id)


@router.post("/inbound")
async def ingest_inbound_signal(
    body: InboundSignalBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    signal = await create_inbound_signal(
        session,
        auth.tenant.id,
        channel=body.channel,
        source=body.source,
        subject=body.subject,
        body_text=body.body_text,
        contact_email=body.contact_email,
        contact_name=body.contact_name,
        external_id=body.external_id,
    )
    return serialize_signal(signal)


@router.post("/{signal_id}/triage")
async def triage_signal_endpoint(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await triage_signal(session, auth.tenant.id, signal_id)
    return result
