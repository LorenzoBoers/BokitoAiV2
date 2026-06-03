"""Multichannel inbox router (dashboard contract).

Mounted under /api/integrations/inbox to match the dashboard's
INTEGRATIONS_API_BASE + integrationsRoutes.inbox.* paths, so the existing
dashboard inbox UI works unchanged in bokito mode.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.inbox_threads import user_numeric_id
from app.services import inbox_threads as svc

router = APIRouter(prefix="/integrations/inbox", tags=["inbox-threads"])


class ThreadPatch(BaseModel):
    status: str | None = None
    assigned_to_user_id: int | None = None
    tags: list[str] | None = None
    priority: str | None = None


class ReplyBody(BaseModel):
    body_text: str
    body_html: str | None = None
    action: str = "send"


class NoteBody(BaseModel):
    body_text: str


def _num(auth: AuthContext) -> int:
    return user_numeric_id(auth.user.id)


@router.get("/threads")
async def list_threads(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    view: str = Query("all_open"),
    search: str | None = Query(None),
    assignee_id: int | None = Query(None),
    tag: str | None = Query(None),
    connection_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(30, ge=1, le=100),
):
    return await svc.list_threads(
        session,
        auth.tenant.id,
        _num(auth),
        view=view,
        search=search,
        assignee_id=assignee_id,
        tag=tag,
        connection_id=connection_id,
        page=page,
        per_page=per_page,
    )


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    detail = await svc.get_thread(session, auth.tenant.id, _num(auth), thread_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Thread not found")
    return detail


@router.patch("/threads/{thread_id}")
async def patch_thread(
    thread_id: int,
    body: ThreadPatch,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    thread = await svc.patch_thread(
        session,
        auth.tenant.id,
        _num(auth),
        thread_id,
        status=body.status,
        assigned_to_user_id=body.assigned_to_user_id,
        tags=body.tags,
        priority=body.priority,
    )
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@router.delete("/threads/{thread_id}")
async def delete_thread(
    thread_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    ok = await svc.delete_thread(session, auth.tenant.id, thread_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Thread not found")
    return {"ok": True}


@router.patch("/threads/{thread_id}/mark-read")
async def mark_read(
    thread_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    thread = await svc.set_read(session, auth.tenant.id, _num(auth), thread_id, read=True)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@router.patch("/threads/{thread_id}/mark-unread")
async def mark_unread(
    thread_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    thread = await svc.set_read(session, auth.tenant.id, _num(auth), thread_id, read=False)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    return thread


@router.post("/threads/{thread_id}/reply")
async def reply(
    thread_id: int,
    body: ReplyBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    message = await svc.reply_to_thread(
        session,
        auth.tenant.id,
        _num(auth),
        thread_id,
        body_text=body.body_text,
        body_html=body.body_html,
        action=body.action,
        direction="outbound",
    )
    if not message:
        raise HTTPException(status_code=404, detail="Thread not found")
    return message


@router.post("/threads/{thread_id}/notes")
async def add_note(
    thread_id: int,
    body: NoteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    message = await svc.reply_to_thread(
        session,
        auth.tenant.id,
        _num(auth),
        thread_id,
        body_text=body.body_text,
        action="note",
        direction="internal",
    )
    if not message:
        raise HTTPException(status_code=404, detail="Thread not found")
    return message


@router.get("/pins")
async def list_pins(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_pins(session, auth.tenant.id, _num(auth))


@router.post("/threads/{thread_id}/pin")
async def pin(
    thread_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.pin_thread(session, auth.tenant.id, _num(auth), thread_id)
    return {"ok": True}


@router.delete("/threads/{thread_id}/pin")
async def unpin(
    thread_id: int,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    await svc.unpin_thread(session, auth.tenant.id, _num(auth), thread_id)
    return {"ok": True}


@router.get("/members")
async def list_members(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.list_members(session, auth.tenant.id)


@router.get("/sync-status")
async def get_sync_status(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    return await svc.sync_status(session, auth.tenant.id)
