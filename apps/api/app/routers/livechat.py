"""Livechat API group compatibility for the restored bokito-chat widget."""

from __future__ import annotations

import secrets
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select as sa_select

from app.db.session import get_session
from app.middleware.rate_limit import rate_limit
from app.models.auth import Tenant, User
from app.models.signal import Signal
from app.services.livechat_compat import (
    create_widget_session_token,
    decode_widget_session_token,
    resolve_tenant_for_livechat,
    session_start_payload,
    widget_assistant_name,
)
from app.services.livechat_stream import (
    get_or_create_widget_thread,
    widget_stream_events,
)

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


@router.post("/session/start", dependencies=[Depends(rate_limit("livechat-session", limit=30))])
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
    assistant_name = await widget_assistant_name(session, tenant.id)
    return session_start_payload(
        tenant,
        user,
        session_token=session_token,
        auth_mode=auth_mode,
        customer_id=customer_id,
        assistant_name=assistant_name,
    )


class SessionIdentifyBody(BaseModel):
    name: str = ""
    email: str = ""
    conversation_id: str | None = None


@router.post("/session/identify", dependencies=[Depends(rate_limit("livechat-identify", limit=10))])
async def session_identify(
    body: SessionIdentifyBody,
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Pre-chat identification: link the visitor's widget Contact to a name/email."""
    import json as _json

    from app.models.channel import Contact

    tenant, _user, token = ctx
    name = body.name.strip()[:120]
    email = body.email.strip().lower()[:254]
    if not name and not email:
        raise HTTPException(status_code=400, detail="Provide a name or email")
    if email and ("@" not in email or "." not in email.split("@")[-1]):
        raise HTTPException(status_code=400, detail="Invalid email address")

    customer_id = None
    try:
        customer_id = decode_widget_session_token(token).get("customer_id")
    except Exception:
        customer_id = None
    if not customer_id:
        raise HTTPException(status_code=400, detail="No visitor session")

    result = await session.execute(
        select(Contact).where(
            Contact.tenant_id == tenant.id,
            Contact.channel == "widget",
            Contact.address == customer_id,
        )
    )
    contact = result.scalar_one_or_none()
    if not contact:
        contact = Contact(
            tenant_id=tenant.id,
            channel="widget",
            address=customer_id,
            status="approved",
        )
        session.add(contact)
    if name:
        contact.display_name = name
    try:
        meta = _json.loads(contact.metadata_json or "{}")
    except Exception:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    if email:
        meta["email"] = email
    contact.metadata_json = _json.dumps(meta)
    await session.flush()

    # Reflect the identity on the active thread so operators see a real name.
    if body.conversation_id:
        try:
            sig_uuid = UUID(body.conversation_id)
        except ValueError:
            sig_uuid = None
        if sig_uuid:
            sig_result = await session.execute(
                select(Signal).where(
                    Signal.id == sig_uuid,
                    Signal.tenant_id == tenant.id,
                    Signal.contact_id == contact.id,
                )
            )
            signal = sig_result.scalar_one_or_none()
            if signal and name:
                signal.contact_name = name
                session.add(signal)
    await session.commit()
    return {
        "ok": True,
        "contact": {"name": contact.display_name, "email": email or meta.get("email") or ""},
    }


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


def _widget_viewer_key(user: User | None, token: str) -> str:
    """Stable per-viewer key for widget read state (logged-in user or visitor)."""
    if user is not None:
        return f"user:{user.id}"
    try:
        customer_id = decode_widget_session_token(token).get("customer_id")
    except Exception:
        customer_id = None
    return f"customer:{customer_id}" if customer_id else ""


async def _mark_widget_seen(session: AsyncSession, signal: Signal, viewer_key: str) -> None:
    """Upsert the viewer's `widget_seen` event so unread counts reset on read."""
    if not viewer_key:
        return
    from datetime import datetime

    from app.models.signal import SignalEvent

    result = await session.execute(
        sa_select(SignalEvent).where(
            SignalEvent.signal_id == signal.id,
            SignalEvent.event_type == "widget_seen",
            SignalEvent.actor_id == viewer_key,
        )
    )
    event = result.scalars().first()
    if event:
        event.created_at = datetime.utcnow()
    else:
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="widget_seen",
                actor_type="visitor",
                actor_id=viewer_key,
            )
        )
    await session.commit()


async def _widget_unread_counts(
    session: AsyncSession,
    tenant_id: UUID,
    signal_ids: list[UUID],
    viewer_key: str,
) -> dict[UUID, int]:
    """Agent messages newer than the viewer's last read or last reply, per thread."""
    counts: dict[UUID, int] = {sid: 0 for sid in signal_ids}
    if not signal_ids or not viewer_key:
        return counts
    from sqlalchemy import func as sa_func

    from app.models.signal import SignalEvent, SignalMessage

    seen_rows = (
        await session.execute(
            sa_select(SignalEvent.signal_id, sa_func.max(SignalEvent.created_at))
            .where(
                SignalEvent.tenant_id == tenant_id,
                SignalEvent.signal_id.in_(signal_ids),
                SignalEvent.event_type == "widget_seen",
                SignalEvent.actor_id == viewer_key,
            )
            .group_by(SignalEvent.signal_id)
        )
    ).all()
    seen = {row[0]: row[1] for row in seen_rows}
    last_reply_rows = (
        await session.execute(
            sa_select(SignalMessage.signal_id, sa_func.max(SignalMessage.created_at))
            .where(
                SignalMessage.tenant_id == tenant_id,
                SignalMessage.signal_id.in_(signal_ids),
                SignalMessage.kind == "user_message",
            )
            .group_by(SignalMessage.signal_id)
        )
    ).all()
    last_reply = {row[0]: row[1] for row in last_reply_rows}
    for sid in signal_ids:
        anchors = [t for t in (seen.get(sid), last_reply.get(sid)) if t]
        query = sa_select(sa_func.count()).where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.signal_id == sid,
            SignalMessage.kind == "agent_message",
        )
        if anchors:
            query = query.where(SignalMessage.created_at > max(anchors))
        counts[sid] = int((await session.execute(query)).scalar() or 0)
    return counts


@router.get("/user/conversations")
async def user_conversations(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    per_page: int = 10,
):
    tenant, user, token = ctx
    if not user:
        return {"items": [], "conversations": [], "per_page": per_page}
    result = await session.execute(
        sa_select(Signal)
        .where(
            Signal.tenant_id == tenant.id,
            Signal.channel == "assistant",
            Signal.owner_user_id == user.id,
        )
        .order_by(Signal.updated_at.desc())
        .limit(per_page)
    )
    signals = result.scalars().all()
    unread = await _widget_unread_counts(
        session, tenant.id, [s.id for s in signals], _widget_viewer_key(user, token)
    )
    items = [
        {
            "id": str(s.id),
            "conversation_id": str(s.id),
            "title": s.subject,
            "updated_at": s.updated_at.isoformat(),
            "unread_count": unread.get(s.id, 0),
        }
        for s in signals
    ]
    return {"items": items, "conversations": items, "per_page": per_page}


@router.get("/customer/conversations")
async def customer_conversations(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    per_page: int = 10,
):
    """Recent widget threads for an anonymous visitor (keyed by customer_id)."""
    tenant, _user, token = ctx
    customer_id = None
    try:
        customer_id = decode_widget_session_token(token).get("customer_id")
    except Exception:
        customer_id = None
    if not customer_id:
        return {"items": [], "conversations": [], "per_page": per_page}
    from app.models.channel import Contact

    contact_result = await session.execute(
        sa_select(Contact).where(
            Contact.tenant_id == tenant.id,
            Contact.channel == "widget",
            Contact.address == customer_id,
        )
    )
    contact = contact_result.scalar_one_or_none()
    if not contact:
        return {"items": [], "conversations": [], "per_page": per_page}
    result = await session.execute(
        sa_select(Signal)
        .where(
            Signal.tenant_id == tenant.id,
            Signal.channel == "widget",
            Signal.contact_id == contact.id,
        )
        .order_by(Signal.updated_at.desc())
        .limit(per_page)
    )
    signals = result.scalars().all()
    unread = await _widget_unread_counts(
        session, tenant.id, [s.id for s in signals], f"customer:{customer_id}"
    )
    items = [
        {
            "id": str(s.id),
            "conversation_id": str(s.id),
            "title": s.subject,
            "updated_at": s.updated_at.isoformat(),
            "unread_count": unread.get(s.id, 0),
        }
        for s in signals
    ]
    return {"items": items, "conversations": items, "per_page": per_page}


async def _get_owned_conversation(
    session: AsyncSession,
    tenant: Tenant,
    user: User | None,
    token: str,
    conversation_id: str,
) -> Signal:
    """Resolve a conversation the caller owns: the logged-in user's own thread,
    or the anonymous visitor's thread matched via the token's customer_id."""
    try:
        sig_uuid = UUID(conversation_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Conversation not found")
    result = await session.execute(
        sa_select(Signal).where(Signal.id == sig_uuid, Signal.tenant_id == tenant.id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if user is not None and signal.owner_user_id == user.id:
        return signal
    customer_id = None
    try:
        customer_id = decode_widget_session_token(token).get("customer_id")
    except Exception:
        customer_id = None
    if customer_id and signal.contact_id:
        from app.models.channel import Contact

        contact = await session.get(Contact, signal.contact_id)
        if contact and contact.channel == "widget" and contact.address == customer_id:
            return signal
    raise HTTPException(status_code=404, detail="Conversation not found")


class CsatBody(BaseModel):
    score: int
    comment: str = ""


@router.post(
    "/conversation/{conversation_id}/csat",
    dependencies=[Depends(rate_limit("livechat-csat", limit=10))],
)
async def submit_conversation_csat(
    conversation_id: str,
    body: CsatBody,
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Visitor satisfaction rating (1-5) for a widget conversation.

    Stored as signal-scoped Feedback so the existing learning loop picks it
    up (eval scores, digests, cockpit). One rating per conversation: rating
    again updates the earlier entry.
    """
    from datetime import datetime

    from app.models.learning import Feedback

    tenant, user, token = ctx
    signal = await _get_owned_conversation(session, tenant, user, token, conversation_id)
    if not 1 <= body.score <= 5:
        raise HTTPException(status_code=400, detail="Score must be between 1 and 5")
    comment = body.comment.strip()[:1000]

    existing = (
        await session.execute(
            select(Feedback).where(
                Feedback.tenant_id == tenant.id,
                Feedback.subject_type == "signal",
                Feedback.subject_id == str(signal.id),
            )
        )
    ).scalars().first()
    sentiment = "up" if body.score >= 4 else ("down" if body.score <= 2 else None)
    if existing:
        existing.score = body.score
        existing.sentiment = sentiment
        existing.comment = comment
        existing.processed = False
        existing.processed_at = None
        existing.created_at = datetime.utcnow()
        session.add(existing)
    else:
        session.add(
            Feedback(
                tenant_id=tenant.id,
                subject_type="signal",
                subject_id=str(signal.id),
                user_id=user.id if user else None,
                score=body.score,
                sentiment=sentiment,
                comment=comment,
            )
        )
    await session.commit()
    return {"ok": True, "score": body.score}


@router.get("/conversation/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    tenant, user, token = ctx
    signal = await _get_owned_conversation(session, tenant, user, token, conversation_id)
    return {
        "id": str(signal.id),
        "conversation_id": str(signal.id),
        "title": signal.subject,
        "updated_at": signal.updated_at.isoformat() if signal.updated_at else None,
    }


@router.get("/conversation/{conversation_id}/messages")
async def conversation_messages(
    conversation_id: str,
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    per_page: int = 100,
):
    import json as _json

    from app.models.signal import SignalMessage

    tenant, user, token = ctx
    signal = await _get_owned_conversation(session, tenant, user, token, conversation_id)
    # Fetching the transcript is the widget's read moment; it resets the
    # thread's unread badge for this viewer.
    await _mark_widget_seen(session, signal, _widget_viewer_key(user, token))
    result = await session.execute(
        sa_select(SignalMessage)
        .where(SignalMessage.signal_id == signal.id)
        .order_by(SignalMessage.created_at)
        .limit(min(per_page, 200))
    )
    items = []
    for m in result.scalars().all():
        if m.kind in ("system_event", "internal_note"):
            continue
        if not m.body_text:
            continue
        try:
            attachments = _json.loads(m.attachments_json or "[]")
        except Exception:
            attachments = []
        created = m.received_at or m.created_at
        items.append(
            {
                "id": str(m.id),
                "sender_type": "customer" if m.direction == "inbound" else "ai",
                "message_content": m.body_text or "",
                "created_at": created.isoformat() if created else None,
                "attachments": attachments,
            }
        )
    return {"items": items, "per_page": per_page}


_DEFAULT_WIDGET_PREFS: dict[str, Any] = {
    "theme": "system",
    "sound_effects": True,
    "sound_notifications": True,
    "hidden_conversations": [],
}


def _user_widget_prefs(user: User | None) -> dict[str, Any]:
    import json as _json

    if not user:
        return dict(_DEFAULT_WIDGET_PREFS)
    try:
        stored = _json.loads(user.settings_json or "{}").get("widget_preferences")
    except Exception:
        stored = None
    if not isinstance(stored, dict):
        stored = {}
    return {**_DEFAULT_WIDGET_PREFS, **stored}


@router.get("/user/preferences")
async def user_preferences(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
):
    _tenant, user, _token = ctx
    return {"preferences": _user_widget_prefs(user)}


@router.patch("/user/preferences")
async def patch_user_preferences(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    body: dict[str, Any] | None = None,
):
    """Persist widget preferences for logged-in users; anonymous visitors keep
    their preferences in localStorage on the widget side."""
    import json as _json

    _tenant, user, _token = ctx
    prefs = (body or {}).get("preferences") if isinstance(body, dict) else {}
    if not isinstance(prefs, dict):
        prefs = {}
    merged = {
        "theme": prefs.get("theme", "system"),
        "sound_effects": bool(prefs.get("sound_effects", True)),
        "sound_notifications": bool(prefs.get("sound_notifications", True)),
        "hidden_conversations": prefs.get("hidden_conversations") or [],
    }
    if user:
        try:
            stored = _json.loads(user.settings_json or "{}")
        except Exception:
            stored = {}
        if not isinstance(stored, dict):
            stored = {}
        stored["widget_preferences"] = merged
        user.settings_json = _json.dumps(stored)
        session.add(user)
        await session.commit()
    return {"preferences": merged}


@router.post("/conversation")
async def create_conversation(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    body: dict[str, Any] | None = None,
):
    tenant, user, token = ctx
    customer_id = None
    if isinstance(body, dict):
        customer_id = body.get("customer_id")
    if not customer_id:
        # The session token embeds the visitor's customer_id; use it so
        # anonymous threads stay linked to the same Contact across visits.
        try:
            customer_id = decode_widget_session_token(token).get("customer_id")
        except Exception:
            customer_id = None
    signal = await get_or_create_widget_thread(
        session, tenant, user, customer_id=customer_id
    )
    await session.commit()
    if getattr(signal, "_newly_created", False):
        from app.services.webhooks import emit_webhook_event, signal_event_data

        signal._newly_created = False
        await emit_webhook_event(session, tenant.id, "signal.created", signal_event_data(signal))
    conv_id = str(signal.id)
    return {"conversation_id": conv_id, "id": conv_id, "session_token": token}


@router.post("/attachment", dependencies=[Depends(rate_limit("livechat-attachment", limit=20))])
async def upload_attachment(
    ctx: Annotated[tuple[Tenant, User | None, str], Depends(_optional_widget_auth)],
    file: UploadFile = File(...),
):
    from app.services.storage import get_storage_backend, guess_mime

    tenant, _user, _token = ctx
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 10MB)")
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    mime = guess_mime(file.filename or "file", file.content_type)
    if not mime.startswith("image/"):
        raise HTTPException(status_code=415, detail="Only image attachments are supported")
    backend = get_storage_backend()
    stored = await backend.store(
        data=data,
        filename=file.filename or "file",
        mime=mime,
        tenant_id=str(tenant.id),
    )
    return stored.to_attachment()


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
    signal = await get_or_create_widget_thread(
        session, tenant, user, conversation_id=body.conversation_id
    )
    await session.commit()

    async def event_generator():
        async for chunk in widget_stream_events(
            session, tenant, user, message=message, attachments=attachments, signal=signal
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
    signal = await get_or_create_widget_thread(
        session, tenant, user, conversation_id=body.conversation_id
    )
    await session.commit()

    async def event_generator():
        async for chunk in widget_stream_events(
            session, tenant, user, message=message, signal=signal
        ):
            yield chunk

    return StreamingResponse(event_generator(), media_type="text/event-stream")
