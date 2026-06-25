"""Unified SENSING endpoints (Signal model) with inbox-parity for Messages hub."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.auth import user_numeric_id
from app.services import signal_threads as svc
from app.services.interpretation import triage_signal
from app.services.signals import create_inbound_signal, serialize_signal

router = APIRouter(prefix="/signals", tags=["signals"])


class InboundSignalBody(BaseModel):
    channel: str = "email"
    source: str = "mock"
    subject: str = ""
    body_text: str
    contact_email: str = ""
    contact_name: str = ""
    external_id: str = ""


class ThreadPatch(BaseModel):
    status: str | None = None
    assigned_to_user_id: int | None = None
    tags: list[str] | None = None
    priority: str | None = None
    project_id: UUID | None = None


class ReplyBody(BaseModel):
    body_text: str
    body_html: str | None = None
    action: str = "send"


class NoteBody(BaseModel):
    body_text: str


class ResolveBody(BaseModel):
    action: str


def _num(auth: AuthContext) -> int:
    return user_numeric_id(auth.user.id)


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


@router.get("/pins")
async def list_pins(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_pins(session, auth.tenant.id, auth.user.id)


@router.get("/members")
async def list_members(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_members(session, auth.tenant.id)


@router.get("/sync-status")
async def sync_status(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.sync_status(session, auth.tenant.id)


@router.get("/badge-counts")
async def badge_counts(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.nav_badge_counts(
        session,
        auth.tenant.id,
        auth.user.id,
        include_agents_attention=auth.is_staff or auth.role in ("owner", "admin"),
    )


@router.get("")
async def list_signal_threads(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    view: str = Query("all_open"),
    folder: str | None = Query(None),
    channel: str | None = Query(None),
    search: str | None = Query(None),
    assignee_id: int | None = Query(None),
    tag: str | None = Query(None),
    connection_id: str | None = Query(None),
    email_connection_id: int | None = Query(None),
    project_id: str | None = Query(None),
    agent_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
):
    return await svc.list_threads(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        view=view,
        folder=folder,
        channel=channel,
        search=search,
        assignee_id=assignee_id,
        tag=tag,
        connection_id=connection_id,
        email_connection_id=email_connection_id,
        project_id=project_id,
        agent_id=agent_id,
        page=page,
        per_page=per_page,
    )


@router.get("/{signal_id}")
async def get_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    detail = await svc.get_thread(session, auth.tenant.id, auth.user.id, signal_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Signal not found")
    return detail


@router.patch("/{signal_id}")
async def patch_signal(
    signal_id: UUID,
    body: ThreadPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    updates = body.model_dump(exclude_unset=True)
    project_id_set = "project_id" in updates
    project_id = updates.pop("project_id", None)
    thread = await svc.patch_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        signal_id,
        status=updates.get("status"),
        assigned_to_user_id=updates.get("assigned_to_user_id"),
        tags=updates.get("tags"),
        priority=updates.get("priority"),
        project_id=project_id,
        project_id_set=project_id_set,
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Signal not found")
    return thread


@router.delete("/{signal_id}")
async def delete_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    ok = await svc.delete_thread(session, auth.tenant.id, signal_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Signal not found")
    return {"ok": True}


@router.patch("/{signal_id}/mark-read")
async def mark_read(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    thread = await svc.set_read(
        session, auth.tenant.id, auth.user.id, _num(auth), signal_id, read=True
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Signal not found")
    return thread


@router.patch("/{signal_id}/mark-unread")
async def mark_unread(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    thread = await svc.set_read(
        session, auth.tenant.id, auth.user.id, _num(auth), signal_id, read=False
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Signal not found")
    return thread


@router.post("/{signal_id}/reply")
async def reply(
    signal_id: UUID,
    body: ReplyBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    message = await svc.reply_to_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        signal_id,
        body_text=body.body_text,
        body_html=body.body_html,
        action=body.action,
    )
    if not message:
        raise HTTPException(status_code=404, detail="Signal not found")
    return message


@router.post("/{signal_id}/takeover")
async def takeover_thread(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Human takes over a thread; the AI stops auto-replying until released."""
    result = await svc.set_ai_paused(
        session, auth.tenant.id, auth.user.id, signal_id, paused=True
    )
    if not result:
        raise HTTPException(status_code=404, detail="Signal not found")
    return result


@router.post("/{signal_id}/release")
async def release_thread(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Hand the thread back to the AI agent."""
    result = await svc.set_ai_paused(
        session, auth.tenant.id, auth.user.id, signal_id, paused=False
    )
    if not result:
        raise HTTPException(status_code=404, detail="Signal not found")
    return result


@router.post("/{signal_id}/notes")
async def add_note(
    signal_id: UUID,
    body: NoteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    message = await svc.reply_to_thread(
        session,
        auth.tenant.id,
        auth.user.id,
        _num(auth),
        signal_id,
        body_text=body.body_text,
        direction="internal",
        kind="internal_note",
    )
    if not message:
        raise HTTPException(status_code=404, detail="Signal not found")
    return message


@router.post("/{signal_id}/pin")
async def pin_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.pin_thread(session, auth.tenant.id, auth.user.id, signal_id)
    return {"ok": True}


@router.delete("/{signal_id}/pin")
async def unpin_signal(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.unpin_thread(session, auth.tenant.id, auth.user.id, signal_id)
    return {"ok": True}


@router.post("/{signal_id}/messages/{message_id}/resolve")
async def resolve_decision(
    signal_id: UUID,
    message_id: UUID,
    body: ResolveBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.resolve_message_decision(
        session,
        auth.tenant.id,
        auth.user.id,
        signal_id,
        message_id,
        action=body.action,
    )


@router.post("/{signal_id}/triage")
async def triage_signal_endpoint(
    signal_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await triage_signal(session, auth.tenant.id, signal_id)
    return result
