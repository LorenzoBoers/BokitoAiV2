"""Continue a website chat on WhatsApp.

The widget agent hands the visitor a ``wa.me`` link with a prefilled message
that carries a short code (``HandoverCode``). The code was only visible inside
that widget session, so a WhatsApp message carrying it links the number to the
widget person with basis ``verified``. The new conversation keeps the owner,
gets a short summary on WhatsApp, and waits for a person; the widget
conversation closes with a pointer to it.

Settings live in tenant ``livechat_settings.whatsapp_handover``:
``{enabled, account_id, number}``. ``number`` is only a fallback for the
public number when the account has not reported it yet.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import quote
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import tenant_settings
from app.models.auth import Tenant
from app.models.channel import ChannelAccount, Contact
from app.models.customer_verify import HandoverCode
from app.models.signal import Signal, SignalEvent, SignalMessage

CODE_TTL = timedelta(days=7)
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 4
CODE_PATTERN = re.compile(r"\bref\W{0,3}([A-Z2-9]{4})\b", re.IGNORECASE)
SUMMARY_MESSAGES = 6

_PREFILL = {
    "nl": "Ik ga verder met mijn chat (ref {code})",
    "en": "I am continuing my chat (ref {code})",
}
_SUMMARY = {
    "nl": (
        "Fijn dat je hier verder gaat. Je vroeg op de website: {topic}\n"
        "Een collega reageert zo snel mogelijk."
    ),
    "en": (
        "Thanks for continuing here. On the website you asked: {topic}\n"
        "A colleague replies as soon as possible."
    ),
}


def handover_settings(
    tenant: Tenant | None, *, widget_account: ChannelAccount | None = None
) -> dict[str, Any]:
    if widget_account is not None:
        from app.services.widget_channel import handover_from_account

        return handover_from_account(tenant, widget_account)
    livechat = tenant_settings(tenant).get("livechat_settings") if tenant else None
    raw = livechat.get("whatsapp_handover") if isinstance(livechat, dict) else None
    raw = raw if isinstance(raw, dict) else {}
    return {
        "enabled": bool(raw.get("enabled")),
        "account_id": str(raw.get("account_id") or ""),
        "number": digits(raw.get("number")),
    }


def digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def account_number(account: ChannelAccount | None) -> str:
    """The public WhatsApp number the account reported (digits only)."""
    if account is None:
        return ""
    try:
        data = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        return ""
    return digits(data.get("display_phone_number")) if isinstance(data, dict) else ""


def remember_account_number(account: ChannelAccount, value: Any) -> bool:
    """Store the number from webhook metadata; True when it changed (caller commits)."""
    number = digits(value)
    if not number or number == account_number(account):
        return False
    try:
        data = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        data = {}
    data = data if isinstance(data, dict) else {}
    data["display_phone_number"] = number
    account.settings_json = json.dumps(data)
    return True


async def handover_target(
    session: AsyncSession,
    tenant: Tenant | None,
    *,
    widget_account: ChannelAccount | None = None,
) -> tuple[ChannelAccount | None, str]:
    """(WhatsApp account, public number) when continuing on WhatsApp is switched on and usable."""
    cfg = handover_settings(tenant, widget_account=widget_account)
    if tenant is None or not cfg["enabled"] or not cfg["account_id"]:
        return None, ""
    try:
        account_id = UUID(cfg["account_id"])
    except ValueError:
        return None, ""
    account = await session.get(ChannelAccount, account_id)
    if (
        account is None
        or account.tenant_id != tenant.id
        or account.channel != "whatsapp"
        or not account.is_enabled
    ):
        return None, ""
    number = account_number(account) or cfg["number"]
    return (account, number) if number else (None, "")


def _new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def _lang(value: Any) -> str:
    return "nl" if str(value or "").lower().startswith("nl") else "en"


async def create_handover(
    session: AsyncSession, tenant: Tenant, signal: Signal, *, language: str = ""
) -> dict[str, Any]:
    """A ``wa.me`` link with the code for this widget conversation (caller commits)."""
    if signal.channel != "widget":
        return {"error": "Continuing on WhatsApp only works from the website chat"}
    widget = None
    if signal.channel_account_id:
        widget = await session.get(ChannelAccount, signal.channel_account_id)
        if widget is None or widget.channel != "widget":
            widget = None
    account, number = await handover_target(session, tenant, widget_account=widget)
    if account is None:
        return {"error": "Continuing on WhatsApp is not switched on for this workspace"}
    now = datetime.utcnow()
    lang = _lang(language)
    row = (
        await session.execute(
            select(HandoverCode).where(
                HandoverCode.tenant_id == tenant.id,
                HandoverCode.from_signal_id == signal.id,
                HandoverCode.used_at.is_(None),
                HandoverCode.expires_at > now,
            )
        )
    ).scalars().first()
    if row is None:
        row = HandoverCode(
            tenant_id=tenant.id,
            code=_new_code(),
            from_signal_id=signal.id,
            whatsapp_account_id=account.id,
            language=lang,
            expires_at=now + CODE_TTL,
        )
    else:
        row.language = lang
    session.add(row)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant.id,
            event_type="whatsapp_handover_offered",
            actor_type="agent",
            payload_json=json.dumps({"code": row.code}),
        )
    )
    text = _PREFILL[lang].format(code=row.code)
    return {
        "code": row.code,
        "link": f"https://wa.me/{number}?text={quote(text)}",
        "prefilled_text": text,
        "expires_at": row.expires_at.isoformat(),
    }


def find_codes(text: str) -> list[str]:
    return [m.upper() for m in CODE_PATTERN.findall(text or "")]


async def _topic(session: AsyncSession, widget: Signal) -> str:
    rows = (
        await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == widget.id, SignalMessage.direction == "inbound")
            .order_by(SignalMessage.created_at.desc())
            .limit(SUMMARY_MESSAGES)
        )
    ).scalars().all()
    for message in rows:
        text = re.sub(r"\s+", " ", message.body_text or message.body_preview or "").strip()
        if text:
            return text if len(text) <= 200 else f"{text[:197]}..."
    return widget.subject or ""


async def claim_handover(session: AsyncSession, signal: Signal, body_text: str) -> bool:
    """Continue a widget conversation in this new WhatsApp conversation.

    Returns True when a valid code matched; the caller then skips the normal
    agent run. Commits.
    """
    if signal.channel != "whatsapp":
        return False
    codes = find_codes(body_text)
    if not codes:
        return False
    now = datetime.utcnow()
    row = (
        await session.execute(
            select(HandoverCode).where(
                HandoverCode.tenant_id == signal.tenant_id,
                HandoverCode.code.in_(codes),
                HandoverCode.used_at.is_(None),
                HandoverCode.expires_at > now,
            )
        )
    ).scalars().first()
    if row is None or (row.whatsapp_account_id and row.whatsapp_account_id != signal.channel_account_id):
        return False
    widget = await session.get(Signal, row.from_signal_id)
    if widget is None or widget.tenant_id != signal.tenant_id:
        return False

    from app.channels.outbound import deliver_outbound
    from app.gateway.publish import publish_signal_message, publish_thread_update
    from app.services.contact_identity import LinkProposal, apply_link, canonical
    from app.services.handoff import request_human_handoff
    from app.services.ownership import set_owner

    row.used_at = now
    row.to_signal_id = signal.id
    session.add(row)

    person = await canonical(session, await session.get(Contact, widget.contact_id)) if widget.contact_id else None
    if person is not None:
        try:
            await apply_link(
                session,
                signal,
                LinkProposal(
                    outcome="link",
                    basis="verified",
                    phone=signal.contact_phone or "",
                    name=person.display_name or "",
                    person=person,
                ),
                actor_type="system",
                publish=False,
            )
        except ValueError:
            pass

    if widget.assignee_kind:
        owner_id = (
            widget.assigned_user_id
            if widget.assignee_kind == "user"
            else widget.assignee_team_id
            if widget.assignee_kind == "team"
            else widget.agent_id
        )
        set_owner(signal, widget.assignee_kind, owner_id)
    signal.subject = signal.subject or widget.subject
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="whatsapp_handover_claimed",
            actor_type="system",
            payload_json=json.dumps({"from_signal_id": str(widget.id), "code": row.code}),
        )
    )

    lang = _lang(row.language)
    summary = _SUMMARY[lang].format(topic=await _topic(session, widget) or widget.subject or "-")
    reply = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind="agent_message",
        direction="outbound",
        role="assistant",
        author_agent_id=widget.agent_id,
        body_text=summary,
        body_preview=summary[:200],
        received_at=now,
        metadata_json=json.dumps({"whatsapp_handover": True}),
    )
    session.add(reply)
    await session.flush()
    delivery = await deliver_outbound(session, signal, body_text=summary)
    reply.auto_sent = delivery.status.startswith("sent")
    session.add(reply)

    await request_human_handoff(
        session,
        signal.tenant_id,
        signal,
        reason=summary,
        via="whatsapp_handover",
        actor_type="system",
    )

    note_text = (
        "Doorgezet naar WhatsApp" if lang == "nl" else "Continued on WhatsApp"
    )
    note = SignalMessage(
        signal_id=widget.id,
        tenant_id=widget.tenant_id,
        kind="system_event",
        direction="internal",
        role="system",
        body_text=note_text,
        body_preview=note_text,
        metadata_json=json.dumps({"whatsapp_handover": True, "to_signal_id": str(signal.id)}),
    )
    session.add(note)
    widget.status = "closed"
    widget.last_message_at = now
    widget.updated_at = now
    session.add(widget)
    await session.commit()
    await publish_signal_message(widget, note)
    await publish_signal_message(signal, reply)
    await publish_thread_update(widget)
    await publish_thread_update(signal)
    return True
