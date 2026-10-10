import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.learning import Feedback
router = APIRouter(tags=["inbox-settings"])


class FeedbackCreate(BaseModel):
    score: int | None = None
    sentiment: str | None = None  # up | down
    comment: str = ""


class PersonaUpdate(BaseModel):
    tone: str | None = None
    do_text: str | None = None
    dont_text: str | None = None


class AiLanguageUpdate(BaseModel):
    # "auto" (mirror the customer's language) or a fixed ISO code (nl, en, ...).
    reply_language: str | None = None
    # Language for AI text addressed to the team (summaries, explanations).
    workspace_language: str | None = None
    # Default sender identity when approving a suggested reply: "user" | "agent".
    reply_send_as: str | None = None


@router.get("/settings/ai-language")
async def get_ai_language(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """AI language policy and the default sender identity for approved drafts.

    How the AI handles conversations lives under ``/api/ai-handling``.
    """
    from app.services.language import resolve_reply_language, resolve_workspace_language
    from app.services.signatures import tenant_reply_send_as

    return {
        "reply_language": resolve_reply_language(auth.tenant, None),
        "workspace_language": resolve_workspace_language(auth.tenant),
        "reply_send_as": tenant_reply_send_as(auth.tenant),
    }


class EmailSignatureUpdate(BaseModel):
    email_signature_html: str | None = None


@router.get("/settings/email-signature")
async def get_email_signature(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """Workspace email signature template (placeholders filled per sender)."""
    from app.services.signatures import tenant_signature_html

    return {"email_signature_html": tenant_signature_html(auth.tenant)}


@router.put("/settings/email-signature")
async def update_email_signature(
    body: EmailSignatureUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.signatures import MAX_SIGNATURE_LENGTH, set_tenant_signature_html, tenant_signature_html

    auth.require_role("owner", "admin")
    raw = body.email_signature_html if body.email_signature_html is not None else ""
    if len(raw) > MAX_SIGNATURE_LENGTH:
        raise HTTPException(status_code=400, detail=f"Signature too long (max {MAX_SIGNATURE_LENGTH})")
    tenant = auth.tenant
    set_tenant_signature_html(tenant, raw)
    session.add(tenant)
    await session.commit()
    return {"email_signature_html": tenant_signature_html(tenant)}


@router.put("/settings/ai-language")
async def update_ai_language(
    body: AiLanguageUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.language import (
        REPLY_LANGUAGE_CHOICES,
        WORKSPACE_LANGUAGE_CHOICES,
        resolve_reply_language,
        resolve_workspace_language,
    )

    auth.require_role("owner", "admin")
    if body.reply_language is not None and body.reply_language not in REPLY_LANGUAGE_CHOICES:
        raise HTTPException(status_code=400, detail="Invalid reply_language")
    if (
        body.workspace_language is not None
        and body.workspace_language not in WORKSPACE_LANGUAGE_CHOICES
    ):
        raise HTTPException(status_code=400, detail="Invalid workspace_language")
    from app.services.signatures import SEND_AS_CHOICES, tenant_reply_send_as

    if body.reply_send_as is not None and body.reply_send_as not in SEND_AS_CHOICES:
        raise HTTPException(status_code=400, detail="reply_send_as must be 'user' or 'agent'")

    tenant = auth.tenant
    settings = json.loads(tenant.settings_json or "{}")
    if body.reply_language is not None:
        settings["ai_reply_language"] = body.reply_language
    if body.workspace_language is not None:
        settings["ai_workspace_language"] = body.workspace_language
    if body.reply_send_as is not None:
        settings["reply_send_as"] = body.reply_send_as
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return {
        "reply_language": resolve_reply_language(tenant, None),
        "workspace_language": resolve_workspace_language(tenant),
        "reply_send_as": tenant_reply_send_as(tenant),
    }


class WhatsAppHandoverSetting(BaseModel):
    enabled: bool = False
    account_id: str = ""
    # Public number customers write to; only needed until the account reports it.
    number: str = ""


class WhatsAppHandoverState(WhatsAppHandoverSetting):
    number_known: bool = False
    ready: bool = False


class WidgetSettingsUpdate(BaseModel):
    pre_chat_form: bool | None = None
    offline_message: str | None = None
    whatsapp_handover: WhatsAppHandoverSetting | None = None


class WidgetSettingsResponse(BaseModel):
    pre_chat_form: bool
    offline_message: str
    team_available: bool
    whatsapp_handover: WhatsAppHandoverState


async def _widget_settings_payload(session: AsyncSession, tenant) -> dict:
    from app.services.tenant_bootstrap import ensure_widget_channel
    from app.services.widget_channel import widget_payload

    account = await ensure_widget_channel(session, tenant.id, commit=False)
    payload = await widget_payload(session, tenant, account)
    return {
        "pre_chat_form": payload["pre_chat_form"],
        "offline_message": payload["offline_message"],
        "team_available": payload["team_available"],
        "whatsapp_handover": payload["whatsapp_handover"],
    }


@router.get("/settings/widget", response_model=WidgetSettingsResponse)
async def get_widget_settings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Widget behaviour: pre-chat form, and whether someone who handles the widget is available now."""
    return await _widget_settings_payload(session, auth.tenant)


@router.put("/settings/widget", response_model=WidgetSettingsResponse)
async def update_widget_settings(
    body: WidgetSettingsUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Change the pre-chat form, the offline message, or continuing on WhatsApp.

    Continuing on WhatsApp needs a connected WhatsApp channel of this workspace.
    """
    auth.require_role("owner", "admin")
    from app.models.channel import ChannelAccount
    from app.services.tenant_bootstrap import ensure_widget_channel
    from app.services.widget_channel import apply_widget_livechat
    from app.services.whatsapp_handover import digits

    account = await ensure_widget_channel(session, auth.tenant.id, commit=False)
    livechat: dict = {}
    if body.pre_chat_form is not None:
        livechat["pre_chat_form"] = body.pre_chat_form
    if body.offline_message is not None:
        livechat["offline_message"] = body.offline_message.strip()[:500]
    if body.whatsapp_handover is not None:
        handover = body.whatsapp_handover
        if handover.account_id:
            try:
                wa = await session.get(ChannelAccount, UUID(handover.account_id))
            except ValueError:
                wa = None
            if wa is None or wa.tenant_id != auth.tenant.id or wa.channel != "whatsapp":
                raise HTTPException(status_code=422, detail="Choose a WhatsApp channel of this workspace")
        elif handover.enabled:
            raise HTTPException(status_code=422, detail="Choose the WhatsApp channel to continue on")
        livechat["whatsapp_handover"] = {
            "enabled": handover.enabled,
            "account_id": handover.account_id,
            "number": digits(handover.number)[:20],
        }
    if livechat:
        apply_widget_livechat(account, livechat)
        session.add(account)
    await session.commit()
    return await _widget_settings_payload(session, auth.tenant)



@router.post("/messages/{message_id}/feedback")
async def create_feedback(
    message_id: UUID,
    body: FeedbackCreate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    sentiment = body.sentiment
    if sentiment is not None and sentiment not in ("up", "down"):
        raise HTTPException(status_code=400, detail="sentiment must be 'up' or 'down'")
    score = body.score
    if score is None and sentiment:
        score = 5 if sentiment == "up" else 1
    if score is None:
        raise HTTPException(status_code=400, detail="Provide a score or sentiment")
    if not 1 <= score <= 5:
        raise HTTPException(status_code=400, detail="score must be between 1 and 5")

    # The message must exist inside this tenant: feedback on foreign or
    # non-existent ids would poison cockpit averages and learning data.
    from app.models.signal import SignalMessage

    message = (
        await session.execute(
            select(SignalMessage).where(
                SignalMessage.id == message_id,
                SignalMessage.tenant_id == auth.tenant.id,
            )
        )
    ).scalars().first()
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")

    # One feedback entry per user per message: re-voting updates it.
    existing = (
        await session.execute(
            select(Feedback).where(
                Feedback.tenant_id == auth.tenant.id,
                Feedback.user_id == auth.user.id,
                Feedback.subject_type == "message",
                Feedback.subject_id == str(message_id),
            )
        )
    ).scalars().first()
    if existing:
        existing.score = score
        existing.sentiment = sentiment
        if body.comment:
            existing.comment = body.comment
        existing.processed = False
        fb = existing
    else:
        fb = Feedback(
            tenant_id=auth.tenant.id,
            subject_type="message",
            subject_id=str(message_id),
            score=score,
            sentiment=sentiment,
            comment=body.comment,
            user_id=auth.user.id,
        )
    session.add(fb)
    await session.commit()
    if sentiment == "down":
        from app.models.signal import Signal
        from app.services.ai_handling import check_breaker, load_layers

        signal = await session.get(Signal, message.signal_id)
        if signal is not None:
            account, _contact = await load_layers(session, auth.tenant.id, signal)
            await check_breaker(session, auth.tenant, account)
    return {"id": str(fb.id), "score": score, "sentiment": sentiment}


class NotificationChannelsModel(BaseModel):
    inapp: bool
    push: bool
    email: bool


class NotificationCategoryModel(BaseModel):
    id: str
    channels: NotificationChannelsModel


class NotificationPrefsResponse(BaseModel):
    version: int = 2
    tiers: dict[str, NotificationChannelsModel]
    rows: list[NotificationCategoryModel]
    sound: bool = True


class NotificationPrefsBody(BaseModel):
    version: int | None = None
    tiers: dict[str, dict[str, bool]] | None = None
    rows: list[dict] | None = None
    sound: bool | None = None


@router.get("/user/notification-preferences", response_model=NotificationPrefsResponse)
async def get_notification_preferences(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Your notification switches: per tier (1 now, 2 later, 3 digest) and per event category.

    Tier 2 and 3 never push; tier 3 email is the daily digest. ``sound`` is the
    in-app chime while the dashboard is open.
    """
    from app.services.notify import load_prefs, serialize_prefs

    return serialize_prefs(await load_prefs(session, auth.tenant.id, auth.user.id))


@router.patch("/user/notification-preferences", response_model=NotificationPrefsResponse)
async def patch_notification_preferences(
    body: NotificationPrefsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Change tier or category switches; omitted switches keep their value."""
    from app.services.notify import save_prefs, serialize_prefs

    patch: dict = {"tiers": body.tiers or {}, "rows": body.rows or []}
    if body.sound is not None:
        patch["sound"] = body.sound
    if body.version is not None:
        patch["version"] = body.version
    prefs = await save_prefs(session, auth.tenant.id, auth.user.id, patch)
    return serialize_prefs(prefs)


# Persona lives in the persona.md workspace doc (the same doc agents read in
# their system prompt), so edits here take effect on the next agent run.


@router.get("/persona")
async def get_persona(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.persona import get_persona_fields

    return await get_persona_fields(session, auth.tenant.id)


@router.put("/persona")
async def update_persona(
    body: PersonaUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.services.persona import update_persona_fields

    await update_persona_fields(
        session,
        auth.tenant.id,
        tone=body.tone,
        do_text=body.do_text,
        dont_text=body.dont_text,
        created_by_id=str(auth.user.id),
    )
    return {"ok": True}
