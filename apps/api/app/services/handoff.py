"""Human takeover for external conversations.

One shared path for every way a conversation can escalate to the team:
the agent's ``handoff_to_human`` tool and the widget visitor's own
"talk to a human" action both land here. Pauses AI replies on the thread
(``Signal.ai_paused``), records an ``ai_paused`` SignalEvent, publishes the
thread update, and alerts owners/admins (notification category ``handoff``).
"""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.signal import Signal, SignalEvent
from app.services.language import resolve_workspace_language


def _handoff_copy(lang: str, *, who: str, subject: str | None) -> tuple[str, str]:
    """Title and body for a human-takeover alert, in the workspace language."""
    topic = (subject or who).strip() or who
    if lang == "nl":
        title = f"Medewerker gevraagd: {topic}"[:200]
        body = (
            f"{who} vroeg om een medewerker. AI-antwoorden staan gepauzeerd "
            "tot iemand dit gesprek overneemt."
        )
    else:
        title = f"Human takeover requested: {topic}"[:200]
        body = (
            f"{who} asked for a human. AI replies are paused until someone "
            "takes over the thread."
        )
    return title, body


def _callback_copy(lang: str, *, who: str, subject: str | None) -> tuple[str, str]:
    topic = (subject or who).strip() or who
    if lang == "nl":
        title = f"Terugbelverzoek: {topic}"[:200]
        body = (
            f"{who} vroeg het team om later terug te komen. "
            "De chat blijft open; er is geen live overname."
        )
    else:
        title = f"Callback requested: {topic}"[:200]
        body = (
            f"{who} asked the team to get back. Chat stays open; "
            "no live handoff right now."
        )
    return title, body


async def _workspace_lang(session: AsyncSession, tenant_id: UUID) -> str:
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    return resolve_workspace_language(tenant)


async def request_human_handoff(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    reason: str = "",
    via: str = "handoff_to_human",
    actor_type: str = "user",
    actor_id: str = "",
) -> bool:
    """Escalate ``signal`` to the team. Returns True when newly paused."""
    from app.gateway.publish import publish_thread_update
    from app.services.ops_alerts import notify_tenant_admins

    newly_paused = False
    if not signal.ai_paused:
        signal.ai_paused = True
        signal.has_unread = True
        signal.updated_at = datetime.utcnow()
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="ai_paused",
                actor_type=actor_type,
                actor_id=actor_id,
                payload_json=json.dumps({"ai_paused": True, "via": via, "reason": reason}),
            )
        )
        await session.flush()
        await publish_thread_update(signal)
        newly_paused = True

    lang = await _workspace_lang(session, tenant_id)
    who = signal.contact_name or ("Een bezoeker" if lang == "nl" else "A visitor")
    title, default_body = _handoff_copy(lang, who=who, subject=signal.subject)
    await notify_tenant_admins(
        session,
        tenant_id,
        category="handoff",
        title=title,
        body=reason or default_body,
        payload={"signal_id": str(signal.id), "channel": signal.channel},
        cooldown_minutes=30,
    )
    return newly_paused


async def request_callback(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    reason: str = "",
    via: str = "request_callback",
    actor_type: str = "user",
    actor_id: str = "",
) -> None:
    """Ask the team to get back later. Does not pause AI replies."""
    from app.gateway.publish import publish_thread_update
    from app.services.ops_alerts import notify_tenant_admins

    signal.has_unread = True
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=tenant_id,
            event_type="callback_requested",
            actor_type=actor_type,
            actor_id=actor_id,
            payload_json=json.dumps({"via": via, "reason": reason}),
        )
    )
    await session.flush()
    await publish_thread_update(signal)

    lang = await _workspace_lang(session, tenant_id)
    who = signal.contact_name or ("Een bezoeker" if lang == "nl" else "A visitor")
    title, default_body = _callback_copy(lang, who=who, subject=signal.subject)
    await notify_tenant_admins(
        session,
        tenant_id,
        category="handoff",
        title=title,
        body=reason or default_body,
        payload={"signal_id": str(signal.id), "channel": signal.channel, "via": via},
        cooldown_minutes=30,
    )
