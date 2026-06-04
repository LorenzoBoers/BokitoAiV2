"""Livechat API group compatibility for the restored bokito-chat widget."""

from __future__ import annotations

import secrets
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.auth import Tenant, User
from app.services.livechat_compat import (
    create_widget_session_token,
    decode_widget_session_token,
    resolve_tenant_for_livechat,
    session_start_payload,
)
from app.services.livechat_stream import widget_stream_events

router = APIRouter(prefix="/livechat", tags=["livechat"])


class SessionStartBody(BaseModel):
    agent_slug: str = ""
    customer_id: str | None = None
    identity_token: str | None = None
    tenant_subdomain: str | None = None
    host_auth_token: str | None = None
    auth_mode: str = "optional"
    auth_cookie_name: str | None = None


async def _optional_widget_auth(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> tuple[Tenant, User | None, str]:
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = auth_header.removeprefix("Bearer ").strip()
    try:
        payload = decode_widget_session_token(token)
        tenant_id = UUID(payload["tenant_id"])
        tenant_result = await session.execute(select(Tenant).where(Tenant.id == tenant_id))
        tenant = tenant_result.scalar_one_or_none()
        if not tenant:
            raise HTTPException(status_code=401, detail="Invalid session")
        user: User | None = None
        sub = payload.get("sub")
        if sub:
            user_result = await session.execute(select(User).where(User.id == UUID(sub)))
            user = user_result.scalar_one_or_none()
        return tenant, user, token
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc


@router.post("/session/start")
async def session_start(
    body: SessionStartBody,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    try:
        tenant, user = await resolve_tenant_for_livechat(
            session,
            tenant_subdomain=body.tenant_subdomain,
            host_auth_token=body.host_auth_token,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="Tenant not found") from exc

    auth_mode = (body.auth_mode or "optional").strip().lower()
    if auth_mode not in {"anonymous", "optional", "required"}:
        auth_mode = "optional"

    customer_id = body.customer_id or f"cust_{secrets.token_hex(8)}"
    session_token = create_widget_session_token(
        tenant_id=tenant.id,
        user_id=user.id if user else None,
        customer_id=customer_id,
    )
    return session_start_payload(
        tenant,
        user,
        session_token=session_token,
        auth_mode=auth_mode,
        customer_id=customer_id,
    )


@router.get("/me")
async def livechat_me(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
):
    _tenant, user, _token = ctx
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.display_name or user.email,
    }


@router.get("/user/conversations")
async def user_conversations(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    per_page: int = 10,
):
    _tenant, _user, _token = ctx
    return {"items": [], "conversations": [], "per_page": per_page}


@router.get("/user/preferences")
async def user_preferences(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
):
    return {
        "preferences": {
            "theme": "system",
            "sound_effects": True,
            "sound_notifications": True,
            "hidden_conversations": [],
        }
    }


@router.patch("/user/preferences")
async def patch_user_preferences(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    body: dict[str, Any] | None = None,
):
    prefs = (body or {}).get("preferences") if isinstance(body, dict) else {}
    if not isinstance(prefs, dict):
        prefs = {}
    return {
        "preferences": {
            "theme": prefs.get("theme", "system"),
            "sound_effects": bool(prefs.get("sound_effects", True)),
            "sound_notifications": bool(prefs.get("sound_notifications", True)),
            "hidden_conversations": prefs.get("hidden_conversations") or [],
        }
    }


@router.post("/conversation")
async def create_conversation(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    body: dict[str, Any] | None = None,
):
    _tenant, _user, token = ctx
    conv_id = secrets.token_hex(12)
    return {"conversation_id": conv_id, "id": conv_id, "session_token": token}


class StreamChatBody(BaseModel):
    message: str = ""
    message_content: str | None = None
    conversation_id: str | None = None
    session_token: str | None = None
    page_content: str | None = None
    attachments: list[dict[str, Any]] | None = None

    model_config = {"extra": "allow"}


@router.post("/stream-chat")
async def stream_chat(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    body: StreamChatBody,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, user, _token = ctx
    message = (body.message_content or body.message or "").strip()
    attachments = body.attachments if isinstance(body.attachments, list) else None

    async def event_generator():
        async for chunk in widget_stream_events(
            session, tenant, user, message=message, attachments=attachments
        ):
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.post("/stream-chat-continue")
async def stream_chat_continue(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    body: StreamChatBody,
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Continue after page context handoff (same SSE contract as stream-chat)."""
    tenant, user, _token = ctx
    page_content = (body.page_content or "").strip()
    message = page_content or "Continue with the page context provided."

    async def event_generator():
        async for chunk in widget_stream_events(session, tenant, user, message=message):
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/event-stream")
