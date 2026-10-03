"""Human takeover for external conversations.

One shared path for every way a conversation can escalate to the team:
the agent's ``handoff_to_human`` tool and the widget visitor's own
"talk to a human" action both land here. Sets the conversation's AI handling
to manual (reason ``handoff_requested``), records an ``ai_handling_changed``
SignalEvent, publishes the thread update, and alerts the addressee: the person
or the people in the team the question goes to (``services/addressee.py``;
notification category ``handoff``). An agent-owned conversation moves to them.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
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


async def _route_to_people(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    to: dict[str, Any] | None,
) -> list[UUID]:
    """Who the escalation goes to; an agent-owned conversation moves to them."""
    from app.services.addressee import resolve_addressee
    from app.services.ownership import set_owner
    from app.services.teams import get_team, team_user_ids

    addressee = await resolve_addressee(
        session, tenant_id, agent_id=signal.agent_id, signal=signal, to=to
    )
    if signal.assignee_kind == "agent":
        if addressee.kind == "user":
            set_owner(signal, "user", addressee.user_id)
        else:
            set_owner(signal, "team", addressee.team_id)
        session.add(signal)
    if addressee.kind == "user" and addressee.user_id:
        return [addressee.user_id]
    team = await get_team(session, tenant_id, addressee.team_id) if addressee.team_id else None
    return await team_user_ids(session, team) if team is not None else []


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
    to: dict[str, Any] | None = None,
) -> bool:
    """Escalate ``signal`` to the team. Returns True when newly held."""
    from app.gateway.publish import publish_thread_update
    from app.services.ops_alerts import notify_tenant_admins

    from app.services.ai_handling import REASON_HANDOFF, hold_conversation, is_held

    newly_paused = False
    if not is_held(signal):
        signal.has_unread = True
        hold_conversation(
            session,
            signal,
            reason=REASON_HANDOFF,
            actor_type=actor_type,
            actor_id=actor_id,
            via=via,
        )
        await session.flush()
        await publish_thread_update(signal)
        newly_paused = True

    recipients = await _route_to_people(session, tenant_id, signal, to)
    await session.flush()
    lang = await _workspace_lang(session, tenant_id)
    who = signal.contact_name or ("Een bezoeker" if lang == "nl" else "A visitor")
    title, default_body = _handoff_copy(lang, who=who, subject=signal.subject)
    await notify_tenant_admins(
        session,
        tenant_id,
        category="handoff",
        title=title,
        body=reason or default_body,
        payload={"channel": signal.channel},
        cooldown_minutes=30,
        user_ids=recipients,
        kind="handoff",
        tier=1,
        signal_id=signal.id,
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
    to: dict[str, Any] | None = None,
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
    recipients = await _route_to_people(session, tenant_id, signal, to)
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
        payload={"channel": signal.channel, "via": via},
        cooldown_minutes=30,
        user_ids=recipients,
        kind="handoff",
        tier=2,
        signal_id=signal.id,
    )
