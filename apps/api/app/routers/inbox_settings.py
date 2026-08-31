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
from app.models.notification import UserNotificationPreference
from app.services.channel_ai import AI_MODES, default_ai_mode, inbox_policy, tenant_channel_ai_modes

router = APIRouter(tags=["inbox-settings"])


class InboxSettingsUpdate(BaseModel):
    autonomous_reply: bool | None = None
    certainty_threshold: int | None = None


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
    # Default sender identity when approving a suggested reply: "user" | "agent".
    reply_send_as: str | None = None


@router.get("/inbox/settings")
async def get_inbox_settings(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    return inbox_policy(auth.tenant)


@router.put("/inbox/settings")
async def update_inbox_settings(
    body: InboxSettingsUpdate,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    if body.certainty_threshold is not None and not 1 <= body.certainty_threshold <= 10:
        raise HTTPException(status_code=400, detail="certainty_threshold must be 1-10")
    tenant = auth.tenant
    settings = json.loads(tenant.settings_json or "{}")
    inbox = settings.get("inbox")
    if not isinstance(inbox, dict):
        inbox = {}
    if body.autonomous_reply is not None:
        inbox["autonomous_reply"] = body.autonomous_reply
    if body.certainty_threshold is not None:
        inbox["certainty_threshold"] = body.certainty_threshold
    settings["inbox"] = inbox
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return {"ok": True}


@router.get("/settings/ai-modes")
async def get_ai_modes(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
):
    """Tenant-wide AI mode per channel plus AI language policy."""
    from app.services.language import resolve_reply_language, resolve_workspace_language
    from app.services.signatures import tenant_reply_send_as

    modes = tenant_channel_ai_modes(auth.tenant)
    return {
        "channel_ai_modes": {
            channel: modes.get(channel) or default_ai_mode(channel)
            for channel in ("email", "widget", "whatsapp")
        },
        "reply_language": resolve_reply_language(auth.tenant, None),
        "workspace_language": resolve_workspace_language(auth.tenant),
        "reply_send_as": tenant_reply_send_as(auth.tenant),
    }


@router.put("/settings/ai-modes")
async def update_ai_modes(
    body: AiModesUpdate,
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
    from app.services.signatures import SEND_AS_CHOICES, tenant_reply_send_as

    if body.reply_send_as is not None and body.reply_send_as not in SEND_AS_CHOICES:
        raise HTTPException(status_code=400, detail="reply_send_as must be 'user' or 'agent'")

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
    if body.reply_send_as is not None:
        settings["reply_send_as"] = body.reply_send_as
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return {
        "channel_ai_modes": modes,
        "reply_language": resolve_reply_language(tenant, None),
        "workspace_language": resolve_workspace_language(tenant),
        "reply_send_as": tenant_reply_send_as(tenant),
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
    return {"id": str(fb.id), "score": score, "sentiment": sentiment}


# Only categories the platform actually emits and enforces. Add a row here
# only together with an enforcement check at the emission point.
DEFAULT_NOTIFICATION_ROWS = [
    {"id": "assigned-to-me", "label": "When a conversation is assigned to you", "channels": {"desktop": True, "email": False}},
    {"id": "mentions", "label": "When you are mentioned in conversations", "channels": {"desktop": True, "email": False}},
    # Slack channel: decision cards as DM with Approve/Deny (services/slack_notify.py).
    {"id": "decisions", "label": "When an agent needs your decision on an assigned conversation", "channels": {"desktop": True, "email": False, "slack": False}},
    # Human handoff (owners/admins; emitted via the handoff_to_human tool).
    {"id": "handoff", "label": "When a visitor or customer asks for a human takeover", "channels": {"desktop": True, "email": False}},
    # Ops alerts (owners/admins only; emitted via services/ops_alerts.py).
    {"id": "ops-run-failed", "label": "When an agent run or trigger fails", "channels": {"desktop": True, "email": False}},
    {"id": "ops-channel-disconnect", "label": "When a connected channel stops syncing", "channels": {"desktop": True, "email": False}},
    # Spend alerts (owners/admins only; emitted via services/spend_guard.py).
    {"id": "billing-alerts", "label": "When LLM spend reaches 80% or 100% of the budget", "channels": {"desktop": True, "email": False}},
    # Digest mails (services/digest_mail.py; arq cron). Email-only categories.
    {"id": "digest-daily", "label": "Daily email digest (open threads, pending decisions, agent activity)", "channels": {"email": False}},
    {"id": "digest-weekly", "label": "Weekly email digest", "channels": {"email": False}},
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
