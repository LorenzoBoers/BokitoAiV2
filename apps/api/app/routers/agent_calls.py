"""Operator endpoints for an in-app agent call."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import agent_calls

router = APIRouter(prefix="/calls", tags=["calls"])


def _require_calls() -> None:
    if not agent_calls.calls_enabled():
        raise HTTPException(status_code=404, detail="Not found")


class CallToolBody(BaseModel):
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class TranscriptLine(BaseModel):
    role: str
    text: str


class EndCallBody(BaseModel):
    transcript: list[TranscriptLine] = Field(default_factory=list)


@router.get("/ringing")
async def ringing(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    return await agent_calls.list_ringing(session, auth.tenant.id, auth.user.id)


class RequestCallBody(BaseModel):
    decision_id: UUID


@router.post("/request")
async def request_call(
    body: RequestCallBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    """Call me: ring this person now about one waiting decision card."""
    call = await agent_calls.request_call(session, auth.tenant.id, auth.user.id, body.decision_id)
    await session.commit()
    return agent_calls.serialize_call(call)


@router.post("/{call_id}/accept")
async def accept_call(
    call_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    payload = await agent_calls.accept_call(session, auth.tenant.id, auth.user.id, call_id)
    await session.commit()
    return payload


@router.post("/{call_id}/decline")
async def decline_call(
    call_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    call = await agent_calls.decline_call(session, auth.tenant.id, auth.user.id, call_id)
    await session.commit()
    return {"call_id": str(call.id), "status": call.status}


@router.post("/{call_id}/miss")
async def miss_call(
    call_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    call = await agent_calls.miss_call(session, auth.tenant.id, auth.user.id, call_id)
    await session.commit()
    return {"call_id": str(call.id), "status": call.status}


@router.post("/{call_id}/tool")
async def call_tool(
    call_id: UUID,
    body: CallToolBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    output = await agent_calls.run_call_tool(
        session,
        auth.tenant.id,
        auth.user.id,
        call_id,
        name=body.name,
        arguments=body.arguments,
    )
    await session.commit()
    return {"output": output}


@router.post("/{call_id}/end")
async def end_call(
    call_id: UUID,
    body: EndCallBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    call = await agent_calls.end_call(
        session,
        auth.tenant.id,
        auth.user.id,
        call_id,
        transcript=[line.model_dump() for line in body.transcript],
    )
    await session.commit()
    return {"call_id": str(call.id), "status": call.status}
