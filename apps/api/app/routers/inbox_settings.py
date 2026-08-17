import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.inbox import InboxSettings
from app.models.learning import Feedback
from app.models.notification import UserNotificationPreference
from app.models.policy import AssistantPersona
from app.services.channel_ai import AI_MODES, default_ai_mode, tenant_channel_ai_modes

router = APIRouter(tags=["inbox-settings"])


class InboxSettingsUpdate(BaseModel):
    autonomous_reply: bool | None = None
    certainty_threshold: int | None = None
    rules_text: str | None = None
    labeling_enabled: bool | None = None


class FeedbackCreate(BaseModel):
    score: int | None = None
    sentiment: str | None = None  # up | down
    comment: str = ""


class PersonaUpdate(BaseModel):
    tone: str | None = None
    do_text: str | None = None
    dont_text: str | None = None


class AiModesUpdate(BaseModel):
    channel_ai_modes: dict[str, str] | None = None
    # "auto" (mirror the customer's language) or a fixed ISO code (nl, en, ...).
    reply_language: str | None = None
    # Language for AI text addressed to the team (summaries, explanations).
    workspace_language: str | None = None


@router.get("/inbox/settings")
async def get_inbox_settings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(select(InboxSettings).where(InboxSettings.tenant_id == auth.tenant.id))
    settings_row = result.scalar_one_or_none()
    if not settings_row:
        settings_row = InboxSettings(tenant_id=auth.tenant.id)
        session.add(settings_row)
        await session.commit()
        await session.refresh(settings_row)
    return {
        "autonomous_reply": settings_row.autonomous_reply,
        "certainty_threshold": settings_row.certainty_threshold,
        "rules_text": settings_row.rules_text,
        "labeling_enabled": settings_row.labeling_enabled,
    }


@router.put("/inbox/settings")
async def update_inbox_settings(
    body: InboxSettingsUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await session.execute(select(InboxSettings).where(InboxSettings.tenant_id == auth.tenant.id))
    row = result.scalar_one_or_none() or InboxSettings(tenant_id=auth.tenant.id)
    if body.autonomous_reply is not None:
        row.autonomous_reply = body.autonomous_reply
    if body.certainty_threshold is not None:
        row.certainty_threshold = body.certainty_threshold
    if body.rules_text is not None:
        row.rules_text = body.rules_text
    if body.labeling_enabled is not None:
        row.labeling_enabled = body.labeling_enabled
    session.add(row)
    await session.commit()
    return {"ok": True}


@router.get("/settings/ai-modes")
async def get_ai_modes(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """Tenant-wide AI mode per channel plus AI language policy."""
    from app.services.language import resolve_reply_language, resolve_workspace_language

    modes = tenant_channel_ai_modes(auth.tenant)
    return {
        "channel_ai_modes": {
            channel: modes.get(channel) or default_ai_mode(channel)
            for channel in ("email", "widget")
        },
        "reply_language": resolve_reply_language(auth.tenant, None),
        "workspace_language": resolve_workspace_language(auth.tenant),
    }


@router.put("/settings/ai-modes")
async def update_ai_modes(
    body: AiModesUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    from app.services.language import REPLY_LANGUAGE_CHOICES, WORKSPACE_LANGUAGE_CHOICES

    auth.require_role("owner", "admin")
    for channel, mode in (body.channel_ai_modes or {}).items():
        if mode not in AI_MODES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid mode '{mode}' for channel '{channel}' (use suggest|auto|off)",
            )
    if body.reply_language is not None and body.reply_language not in REPLY_LANGUAGE_CHOICES:
        raise HTTPException(status_code=400, detail="Invalid reply_language")
    if (
        body.workspace_language is not None
        and body.workspace_language not in WORKSPACE_LANGUAGE_CHOICES
    ):
        raise HTTPException(status_code=400, detail="Invalid workspace_language")

    tenant = auth.tenant
    settings = json.loads(tenant.settings_json or "{}")
    modes = settings.get("channel_ai_modes")
    if not isinstance(modes, dict):
        modes = {}
    modes.update(body.channel_ai_modes or {})
    settings["channel_ai_modes"] = modes
    if body.reply_language is not None:
        settings["ai_reply_language"] = body.reply_language
    if body.workspace_language is not None:
        settings["ai_workspace_language"] = body.workspace_language
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return {
        "channel_ai_modes": modes,
        "reply_language": settings.get("ai_reply_language", "auto"),
        "workspace_language": settings.get("ai_workspace_language", "en"),
    }


class WidgetSettingsUpdate(BaseModel):
    pre_chat_form: bool | None = None
    offline_message: str | None = None
    office_hours: dict | None = None


@router.get("/settings/widget")
async def get_widget_settings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """Widget behaviour: pre-chat form, office hours and offline message."""
    from app.services.livechat_compat import office_hours_open, widget_settings_from_tenant

    cfg = widget_settings_from_tenant(auth.tenant)
    return {**cfg, "office_open": office_hours_open(cfg["office_hours"])}


@router.put("/settings/widget")
async def update_widget_settings(
    body: WidgetSettingsUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    from app.services.livechat_compat import (
        DEFAULT_OFFICE_HOURS,
        office_hours_open,
        widget_settings_from_tenant,
    )

    tenant = auth.tenant
    settings = json.loads(tenant.settings_json or "{}")
    livechat = settings.get("livechat_settings")
    if not isinstance(livechat, dict):
        livechat = {}
        settings["livechat_settings"] = livechat

    if body.pre_chat_form is not None:
        livechat["pre_chat_form"] = body.pre_chat_form
    if body.offline_message is not None:
        livechat["offline_message"] = body.offline_message.strip()[:500]
    if body.office_hours is not None:
        hours = {**DEFAULT_OFFICE_HOURS, **{
            k: v for k, v in body.office_hours.items() if k in DEFAULT_OFFICE_HOURS
        }}
        if not isinstance(hours.get("days"), list):
            raise HTTPException(status_code=400, detail="office_hours.days must be a list")
        try:
            hours["days"] = sorted({int(d) for d in hours["days"] if 0 <= int(d) <= 6})
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="office_hours.days must contain 0-6")
        for key in ("start", "end"):
            value = str(hours.get(key) or "")
            parts = value.split(":")
            if len(parts) != 2 or not all(p.isdigit() for p in parts):
                raise HTTPException(status_code=400, detail=f"office_hours.{key} must be HH:MM")
        hours["enabled"] = bool(hours.get("enabled"))
        hours["timezone"] = str(hours.get("timezone") or "Europe/Amsterdam")
        livechat["office_hours"] = hours

    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    cfg = widget_settings_from_tenant(tenant)
    return {**cfg, "office_open": office_hours_open(cfg["office_hours"])}


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
    return {"id": str(fb.id), "score": score, "sentiment": sentiment}


# Only categories the platform actually emits and enforces. Add a row here
# only together with an enforcement check at the emission point.
DEFAULT_NOTIFICATION_ROWS = [
    {"id": "assigned-to-me", "label": "When a conversation is assigned to you", "channels": {"desktop": True, "email": False, "mobile": False}},
    {"id": "mentions", "label": "When you are mentioned in conversations", "channels": {"desktop": True, "email": False, "mobile": False}},
    {"id": "decisions", "label": "When an agent needs your decision on an assigned conversation", "channels": {"desktop": True, "email": False, "mobile": False}},
]


class NotificationPrefsBody(BaseModel):
    rows: list[dict] | None = None


@router.get("/user/notification-preferences")
async def get_notification_preferences(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(UserNotificationPreference).where(
            UserNotificationPreference.tenant_id == auth.tenant.id,
            UserNotificationPreference.user_id == auth.user.id,
        )
    )
    row = result.scalar_one_or_none()
    if not row or not row.prefs_json.strip():
        return {"rows": DEFAULT_NOTIFICATION_ROWS}
    try:
        parsed = json.loads(row.prefs_json)
        if isinstance(parsed, list) and parsed:
            # Keep only known categories; older accounts may have stored rows
            # for categories that no longer exist.
            merged = []
            for default in DEFAULT_NOTIFICATION_ROWS:
                stored = next(
                    (p for p in parsed if isinstance(p, dict) and p.get("id") == default["id"]),
                    None,
                )
                merged.append(stored or default)
            return {"rows": merged}
    except json.JSONDecodeError:
        pass
    return {"rows": DEFAULT_NOTIFICATION_ROWS}


@router.patch("/user/notification-preferences")
async def patch_notification_preferences(
    body: NotificationPrefsBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    rows = body.rows if isinstance(body.rows, list) else DEFAULT_NOTIFICATION_ROWS
    result = await session.execute(
        select(UserNotificationPreference).where(
            UserNotificationPreference.tenant_id == auth.tenant.id,
            UserNotificationPreference.user_id == auth.user.id,
        )
    )
    pref = result.scalar_one_or_none() or UserNotificationPreference(
        tenant_id=auth.tenant.id,
        user_id=auth.user.id,
    )
    pref.prefs_json = json.dumps(rows)
    session.add(pref)
    await session.commit()
    return {"rows": rows}


@router.get("/persona")
async def get_persona(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    result = await session.execute(
        select(AssistantPersona).where(AssistantPersona.tenant_id == auth.tenant.id)
    )
    persona = result.scalar_one_or_none()
    if not persona:
        return {"tone": "", "do_text": "", "dont_text": ""}
    return {"tone": persona.tone, "do_text": persona.do_text, "dont_text": persona.dont_text}


@router.put("/persona")
async def update_persona(
    body: PersonaUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    result = await session.execute(
        select(AssistantPersona).where(AssistantPersona.tenant_id == auth.tenant.id)
    )
    persona = result.scalar_one_or_none() or AssistantPersona(tenant_id=auth.tenant.id)
    if body.tone is not None:
        persona.tone = body.tone
    if body.do_text is not None:
        persona.do_text = body.do_text
    if body.dont_text is not None:
        persona.dont_text = body.dont_text
    session.add(persona)
    await session.commit()
    return {"ok": True}
