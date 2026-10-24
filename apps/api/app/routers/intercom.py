"""Dock intercom: pinned agents, hold-to-talk uploads and the voice note queue."""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services import agent_calls, intercom

router = APIRouter(prefix="/intercom", tags=["intercom"])


def _require_calls() -> None:
    if not agent_calls.calls_enabled():
        raise HTTPException(status_code=404, detail="Not found")


async def _talk(
    *,
    auth: AuthContext,
    session: AsyncSession,
    agent_id: UUID | None,
    audio: UploadFile,
    thread_id: str,
    reply_to_note_id: str,
    position_ms: int | None,
    seat_ids: str = "",
) -> dict[str, Any]:
    def _uuid(raw: str) -> UUID | None:
        try:
            return UUID(raw.strip()) if raw and raw.strip() else None
        except ValueError:
            return None

    data = await audio.read()
    return await intercom.handle_utterance(
        session,
        auth.tenant.id,
        auth.user,
        agent_id=agent_id,
        audio=data,
        filename=audio.filename or "speech.webm",
        mime=audio.content_type or "audio/webm",
        thread_id=_uuid(thread_id),
        reply_to_note_id=_uuid(reply_to_note_id),
        position_ms=position_ms,
        seat_ids=[part.strip() for part in seat_ids.split(",") if part.strip()],
    )


@router.post("/all")
async def talk_all(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
    audio: UploadFile = File(...),
    reply_to_note_id: str = Form(""),
    position_ms: int | None = Form(None),
    seat_ids: str = Form(""),
):
    """All-call dial: a spoken name picks the agent, a playing note gets the reply, else the dock row."""
    return await _talk(
        auth=auth,
        session=session,
        agent_id=None,
        audio=audio,
        thread_id="",
        reply_to_note_id=reply_to_note_id,
        position_ms=position_ms,
        seat_ids=seat_ids,
    )


@router.get("/queue")
async def queue(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
    returning: bool = Query(False, description="The person just came back; three or more waiting notes become one digest first."),
):
    return {"notes": await intercom.list_queue(session, auth.tenant.id, auth.user, returning=returning)}


@router.get("/notes/{note_id}/audio")
async def note_audio(
    note_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    data = await intercom.note_audio(session, auth.tenant.id, auth.user.id, note_id)
    return Response(content=data, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=86400"})


class PlayedBody(BaseModel):
    skipped: bool = False


@router.post("/notes/{note_id}/played")
async def note_played(
    note_id: UUID,
    body: PlayedBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    note = await intercom.mark_played(session, auth.tenant.id, auth.user.id, note_id, skipped=body.skipped)
    return {"note_id": str(note.id), "status": note.status}


@router.get("/last")
async def last_note(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
    agent_id: UUID | None = Query(None, description="Empty for the newest digest"),
):
    """The newest note from this agent, for replay on a click."""
    return {"note": await intercom.last_note(session, auth.tenant.id, auth.user.id, agent_id)}


class RouteBody(BaseModel):
    target_signal_id: UUID | None = None


@router.post("/route/{message_id}")
async def correct_route(
    message_id: UUID,
    body: RouteBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    """Move what was said (and what followed) to another conversation, or a new one when empty."""
    return await intercom.correct_route(
        session, auth.tenant.id, auth.user, message_id, target_id=body.target_signal_id
    )


@router.post("/lane/{agent_id}")
async def open_lane(
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
):
    """This person's intercom conversation with the agent, created on first use. Live mode runs here."""
    from app.services.conversation_moves import intercom_lane

    agent = await intercom._agent(session, auth.tenant.id, agent_id)
    lane = await intercom_lane(
        session, auth.tenant.id, auth.user.id, agent, user_name=auth.user.display_name or auth.user.email
    )
    await session.commit()
    return {"thread_id": str(lane.id), "thread_title": lane.subject or ""}


@router.post("/{agent_id}")
async def talk_agent(
    agent_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[None, Depends(_require_calls)],
    audio: UploadFile = File(...),
    thread_id: str = Form(""),
    reply_to_note_id: str = Form(""),
    position_ms: int | None = Form(None),
):
    """Hold-to-talk on one agent's dial. ``thread_id`` is the card the dial sits on."""
    return await _talk(
        auth=auth,
        session=session,
        agent_id=agent_id,
        audio=audio,
        thread_id=thread_id,
        reply_to_note_id=reply_to_note_id,
        position_ms=position_ms,
    )
