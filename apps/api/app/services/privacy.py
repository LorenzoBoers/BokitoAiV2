"""Privacy / retention / DSAR helpers (AVG Art. 15/17/20 assistance)."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Membership, Tenant, User
from app.models.calendar import CalendarEvent
from app.models.channel import Contact
from app.models.signal import Signal, SignalMessage
from app.services.audit import record_audit

DEFAULT_RETENTION_MESSAGES_DAYS = 365
DEFAULT_RETENTION_CALENDAR_DAYS = 365
DEFAULT_RETENTION_AUDIT_DAYS = 730  # soft policy; not hard-deleted in v1


def privacy_settings_from_tenant(tenant: Tenant) -> dict[str, Any]:
    try:
        raw = json.loads(tenant.settings_json or "{}")
    except (TypeError, json.JSONDecodeError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    privacy = raw.get("privacy") if isinstance(raw.get("privacy"), dict) else {}
    return {
        "retention_messages_days": int(
            privacy.get("retention_messages_days") or DEFAULT_RETENTION_MESSAGES_DAYS
        ),
        "retention_calendar_days": int(
            privacy.get("retention_calendar_days") or DEFAULT_RETENTION_CALENDAR_DAYS
        ),
        "retention_audit_days": int(
            privacy.get("retention_audit_days") or DEFAULT_RETENTION_AUDIT_DAYS
        ),
        "llm_may_use_message_bodies": bool(
            privacy.get("llm_may_use_message_bodies", True)
        ),
    }


def merge_privacy_settings(tenant: Tenant, updates: dict[str, Any]) -> dict[str, Any]:
    try:
        raw = json.loads(tenant.settings_json or "{}")
    except (TypeError, json.JSONDecodeError):
        raw = {}
    if not isinstance(raw, dict):
        raw = {}
    privacy = dict(raw.get("privacy") or {}) if isinstance(raw.get("privacy"), dict) else {}
    for key in (
        "retention_messages_days",
        "retention_calendar_days",
        "retention_audit_days",
        "llm_may_use_message_bodies",
    ):
        if key in updates and updates[key] is not None:
            privacy[key] = updates[key]
    # Clamp retention
    for key in ("retention_messages_days", "retention_calendar_days", "retention_audit_days"):
        if key in privacy:
            privacy[key] = max(30, min(int(privacy[key]), 3650))
    raw["privacy"] = privacy
    tenant.settings_json = json.dumps(raw)
    return privacy_settings_from_tenant(tenant)


def tenant_allows_llm_message_bodies(tenant: Tenant) -> bool:
    return privacy_settings_from_tenant(tenant)["llm_may_use_message_bodies"]


async def export_subject(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    email: str,
    actor_user_id: UUID | None,
) -> dict[str, Any]:
    needle = email.strip().lower()
    if not needle or "@" not in needle:
        raise ValueError("Valid email is required")

    contacts = (
        await session.execute(
            select(Contact).where(
                Contact.tenant_id == tenant_id,
                Contact.address.ilike(needle),
            )
        )
    ).scalars().all()

    signals = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id,
                Signal.contact_email.ilike(needle),
            )
        )
    ).scalars().all()
    signal_ids = [s.id for s in signals]
    messages: list[SignalMessage] = []
    if signal_ids:
        messages = list(
            (
                await session.execute(
                    select(SignalMessage).where(SignalMessage.signal_id.in_(signal_ids))
                )
            ).scalars().all()
        )
    # Also messages where from_address matches
    extra_msgs = (
        await session.execute(
            select(SignalMessage)
            .join(Signal, Signal.id == SignalMessage.signal_id)
            .where(
                Signal.tenant_id == tenant_id,
                SignalMessage.from_address.ilike(needle),
            )
        )
    ).scalars().all()
    seen = {m.id for m in messages}
    for m in extra_msgs:
        if m.id not in seen:
            messages.append(m)

    events = (
        await session.execute(
            select(CalendarEvent).where(CalendarEvent.tenant_id == tenant_id)
        )
    ).scalars().all()
    cal_hits = [
        e
        for e in events
        if needle in (e.attendees_json or "").lower()
        or needle in (e.description or "").lower()
        or needle in (e.title or "").lower()
    ]

    users = (
        await session.execute(select(User).where(User.email.ilike(needle)))
    ).scalars().all()
    memberships = []
    for u in users:
        ms = (
            await session.execute(
                select(Membership).where(
                    Membership.user_id == u.id,
                    Membership.tenant_id == tenant_id,
                )
            )
        ).scalars().all()
        memberships.extend(ms)

    package = {
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "tenant_id": str(tenant_id),
        "subject_email": needle,
        "contacts": [
            {
                "id": str(c.id),
                "address": c.address,
                "display_name": c.display_name,
                "phone": c.phone,
                "company": c.company,
            }
            for c in contacts
        ],
        "signals": [
            {
                "id": str(s.id),
                "subject": s.subject,
                "contact_email": s.contact_email,
                "status": s.status,
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in signals
        ],
        "messages": [
            {
                "id": str(m.id),
                "signal_id": str(m.signal_id),
                "from_address": m.from_address,
                "body_text": m.body_text,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
        "calendar_events": [
            {
                "id": str(e.id),
                "title": e.title,
                "start_at": e.start_at.isoformat() if e.start_at else None,
                "end_at": e.end_at.isoformat() if e.end_at else None,
                "attendees_json": e.attendees_json,
            }
            for e in cal_hits
        ],
        "users": [
            {
                "id": str(u.id),
                "email": u.email,
                "display_name": u.display_name,
            }
            for u in users
        ],
        "memberships": [
            {"user_id": str(m.user_id), "role": m.role} for m in memberships
        ],
    }
    await record_audit(
        session,
        tenant_id,
        action="privacy:export",
        actor_type="user" if actor_user_id else "system",
        actor_id=str(actor_user_id) if actor_user_id else "",
        resource_type="privacy",
        resource_id=needle,
        summary=f"Exported personal data package for {needle}",
        payload={"email": needle, "message_count": len(messages)},
    )
    return package


async def erase_subject(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    email: str,
    actor_user_id: UUID | None,
) -> dict[str, Any]:
    needle = email.strip().lower()
    if not needle or "@" not in needle:
        raise ValueError("Valid email is required")

    scrubbed_contacts = 0
    contacts = (
        await session.execute(
            select(Contact).where(
                Contact.tenant_id == tenant_id,
                Contact.address.ilike(needle),
            )
        )
    ).scalars().all()
    for c in contacts:
        c.address = f"erased-{c.id}@erased.invalid"
        c.display_name = "Erased"
        c.phone = ""
        c.notes = ""
        session.add(c)
        scrubbed_contacts += 1

    signals = (
        await session.execute(
            select(Signal).where(
                Signal.tenant_id == tenant_id,
                Signal.contact_email.ilike(needle),
            )
        )
    ).scalars().all()
    scrubbed_messages = 0
    for s in signals:
        s.contact_email = "erased@erased.invalid"
        s.contact_name = "Erased"
        session.add(s)
        msgs = (
            await session.execute(
                select(SignalMessage).where(SignalMessage.signal_id == s.id)
            )
        ).scalars().all()
        for m in msgs:
            m.body_text = "[erased]"
            m.body_html = ""
            if needle in (m.from_address or "").lower():
                m.from_address = "erased@erased.invalid"
            session.add(m)
            scrubbed_messages += 1

    extra_msgs = (
        await session.execute(
            select(SignalMessage)
            .join(Signal, Signal.id == SignalMessage.signal_id)
            .where(
                Signal.tenant_id == tenant_id,
                SignalMessage.from_address.ilike(needle),
            )
        )
    ).scalars().all()
    for m in extra_msgs:
        m.body_text = "[erased]"
        m.body_html = ""
        m.from_address = "erased@erased.invalid"
        session.add(m)
        scrubbed_messages += 1

    scrubbed_events = 0
    events = (
        await session.execute(
            select(CalendarEvent).where(CalendarEvent.tenant_id == tenant_id)
        )
    ).scalars().all()
    for e in events:
        blob = f"{e.attendees_json or ''} {e.description or ''} {e.title or ''}".lower()
        if needle in blob:
            e.attendees_json = "[]"
            e.description = ""
            if needle in (e.title or "").lower():
                e.title = "[erased]"
            session.add(e)
            scrubbed_events += 1

    await session.commit()
    await record_audit(
        session,
        tenant_id,
        action="privacy:erase_subject",
        actor_type="user" if actor_user_id else "system",
        actor_id=str(actor_user_id) if actor_user_id else "",
        resource_type="privacy",
        resource_id=needle,
        summary=f"Erased personal data for {needle}",
        payload={
            "email": needle,
            "contacts": scrubbed_contacts,
            "messages": scrubbed_messages,
            "calendar_events": scrubbed_events,
        },
    )
    return {
        "ok": True,
        "contacts": scrubbed_contacts,
        "messages": scrubbed_messages,
        "calendar_events": scrubbed_events,
    }


async def purge_expired_for_tenant(
    session: AsyncSession, tenant: Tenant
) -> dict[str, int]:
    privacy = privacy_settings_from_tenant(tenant)
    msg_cut = datetime.utcnow() - timedelta(days=privacy["retention_messages_days"])
    cal_cut = datetime.utcnow() - timedelta(days=privacy["retention_calendar_days"])

    msg_result = await session.execute(
        delete(SignalMessage).where(
            SignalMessage.created_at < msg_cut,
            SignalMessage.signal_id.in_(
                select(Signal.id).where(Signal.tenant_id == tenant.id)
            ),
        )
    )
    cal_result = await session.execute(
        delete(CalendarEvent).where(
            CalendarEvent.tenant_id == tenant.id,
            CalendarEvent.end_at < cal_cut,
        )
    )
    await session.commit()
    return {
        "messages_deleted": int(msg_result.rowcount or 0),
        "calendar_deleted": int(cal_result.rowcount or 0),
    }


_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")
_PHONE_RE = re.compile(r"\+?\d[\d\s\-()]{7,}\d")


def scrub_pii_text(text: str, *, max_len: int = 500) -> str:
    """Strip obvious emails/phones from free-text before learning/persona."""
    out = _EMAIL_RE.sub("[email]", text or "")
    out = _PHONE_RE.sub("[phone]", out)
    out = out.strip()
    if len(out) > max_len:
        out = out[: max_len - 1] + "…"
    return out
