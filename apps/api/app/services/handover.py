"""Handovers between the agent and people on one conversation.

The owner says who is responsible; AI handling says what the agent may do.
An agent owns a conversation while it has the next step: it sends
(autonomous) or it prepares a draft, context and actions (assisted) and then
hands the conversation to a person. This module moves the owner across that
line in both directions:

- ``hand_to_people_after_assist``: the assisted run is done (draft, choice
  card, nothing to send). Owner follows the human chain (last human owner ->
  contact owner -> channel team); no hold, no note: the draft is the note.
- ``escalate_to_human``: the agent (or a decision) gives up on the
  conversation. Owner follows the escalation chain (explicit target -> agent's
  ask target -> learned rule -> last human owner -> contact owner -> channel
  team -> All people), the conversation is held (manual) and a system note
  records who got it and why.
- ``apply_after_human_reply``: a person replied. The channel's routing policy
  (``after_human_reply``) decides whether the agent gets it back or the
  person keeps it; an explicit ``handback`` from the composer wins.
- ``hand_to_agent``: explicit hand back (Hand back button, hand back tool).
- ``apply_reopen_policy``: a closed conversation got a new customer message.

Every crossing writes an ``owner_handover`` SignalEvent. Escalations to
people (not the routine assisted handover, not a person's reply) count as
bounces; reaching ``bounce_limit`` in 24 hours holds the conversation with
reason ``bounce_limit``: people keep it until someone hands it back explicitly.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message
from app.models.auth import Tenant
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services import ai_handling
from app.services.ownership import (
    agent_may_own,
    human_fallback_owner,
    owner_payload,
    picked_up_event,
    remember_human_owner,
    set_owner,
)

HANDOVER_EVENT = "owner_handover"
# Routine handover at the end of an assisted run: never a bounce.
VIA_ASSISTED = "assisted"
# Handovers that are not bounces: the assisted draft handover and anything
# a person did on purpose (reply, pick up, explicit hand back).
_NON_BOUNCE_VIAS = frozenset({VIA_ASSISTED, "reply", "hand_back", "send"})


async def bounce_count(session: AsyncSession, signal: Signal, *, hours: int = ai_handling.BOUNCE_WINDOW_HOURS) -> int:
    """Escalations from the agent to people on this conversation in the last
    ``hours``: the agent gave up (handoff, decision, failure). The routine
    assisted handover and a person's own reply or hand back do not count."""
    since = datetime.utcnow() - timedelta(hours=hours)
    rows = (
        await session.execute(
            select(SignalEvent.payload_json).where(
                SignalEvent.signal_id == signal.id,
                SignalEvent.event_type == HANDOVER_EVENT,
                SignalEvent.created_at >= since,
            )
        )
    ).scalars()
    count = 0
    for raw in rows:
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            continue
        to = payload.get("to") if isinstance(payload.get("to"), dict) else {}
        if to.get("kind") == "agent":
            continue
        if str(payload.get("via") or "") in _NON_BOUNCE_VIAS:
            continue
        count += 1
    return count


def _handover_event(
    signal: Signal,
    *,
    before: dict[str, Any],
    via: str,
    reason: str,
    actor_type: str,
    actor_id: str,
    extra: dict[str, Any] | None = None,
) -> SignalEvent:
    payload = {"from": before, "to": owner_payload(signal), "via": via, "reason": reason}
    if extra:
        payload.update(extra)
    return SignalEvent(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        event_type=HANDOVER_EVENT,
        actor_type=actor_type,
        actor_id=actor_id,
        payload_json=json.dumps(payload),
    )


async def owner_label(session: AsyncSession, signal: Signal) -> str:
    """Display name of the current owner (person, agent or team)."""
    from app.models.agent import Agent
    from app.models.auth import User
    from app.models.team import Team

    if signal.assignee_kind == "user" and signal.assigned_user_id:
        user = await session.get(User, signal.assigned_user_id)
        return (user.display_name or user.email) if user else ""
    if signal.assignee_kind == "agent" and signal.agent_id:
        agent = await session.get(Agent, signal.agent_id)
        return agent.name if agent else ""
    if signal.assignee_team_id:
        team = await session.get(Team, signal.assignee_team_id)
        return team.name if team else ""
    return ""


async def _add_system_note(
    session: AsyncSession, signal: Signal, body: str, *, meta: dict[str, Any]
) -> SignalMessage:
    """Append the agent's handover note and push it to open thread views."""
    note = _system_note(signal, body, meta=meta)
    session.add(note)
    signal.last_message_at = datetime.utcnow()
    await session.flush()
    await publish_signal_message(signal, note)
    return note


def _system_note(signal: Signal, body: str, *, meta: dict[str, Any]) -> SignalMessage:
    return SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind="internal_note",
        direction="internal",
        role="system",
        from_address="",
        to_addresses="",
        subject=signal.subject,
        body_text=body,
        body_preview=body[:200],
        body_html=f"<p>{body}</p>",
        metadata_json=json.dumps({"system_note": True, **meta}),
        received_at=datetime.utcnow(),
    )


async def _tenant(session: AsyncSession, signal: Signal, tenant: Tenant | None) -> Tenant | None:
    return tenant if tenant is not None else await session.get(Tenant, signal.tenant_id)


async def _lang(session: AsyncSession, signal: Signal, tenant: Tenant | None) -> str:
    from app.services.language import resolve_workspace_language

    return resolve_workspace_language(await _tenant(session, signal, tenant))


def _escalation_copy(lang: str, *, owner: str, reason: str, bounce_limited: bool) -> str:
    reason = (reason or "").strip()
    if lang == "nl":
        text = f"Agent heeft dit gesprek overgedragen aan {owner or 'het team'}."
        if reason:
            text += f" Reden: {reason}"
        if bounce_limited:
            text += (
                " Dit gesprek wisselde vandaag te vaak tussen agent en mensen; "
                "het blijft bij mensen tot iemand het expliciet teruggeeft."
            )
        return text
    text = f"The agent handed this conversation to {owner or 'the team'}."
    if reason:
        text += f" Reason: {reason}"
    if bounce_limited:
        text += (
            " It moved between the agent and people too often today; "
            "people keep it until someone hands it back explicitly."
        )
    return text


def _bounce_copy(lang: str, *, owner: str) -> str:
    if lang == "nl":
        return (
            f"Terug naar de agent overgeslagen: dit gesprek wisselde vandaag te vaak "
            f"tussen agent en mensen. {owner or 'Het team'} houdt het tot iemand het teruggeeft."
        )
    return (
        f"Return to the agent skipped: this conversation moved between the agent and "
        f"people too often today. {owner or 'The team'} keeps it until someone hands it back."
    )


async def hand_to_people_after_assist(
    session: AsyncSession,
    signal: Signal,
    *,
    agent: Any = None,
    reason: str = "draft_ready",
    contact: Any = None,
) -> dict[str, Any] | None:
    """The assisted agent finished its part: hand the conversation to a person
    (caller commits).

    Owner follows the human chain (last human owner -> contact owner ->
    channel team, then ``distribute``). Nothing is held and no note is
    written: the draft or card the agent left is what the person sees.
    ``reason`` is ``draft_ready`` | ``pending_decision`` | ``no_reply_needed``
    | ``needs_person`` | ``run_failed``. Returns the handover payload, or None
    when the agent did not own the conversation.
    """
    from app.services.distribution import distribute

    if signal.assignee_kind != "agent":
        return None
    before = owner_payload(signal)
    kind, owner_id = await human_fallback_owner(session, signal, contact=contact)
    set_owner(signal, kind, owner_id)
    session.add(signal)
    if kind == "team":
        await distribute(session, signal)
    event = _handover_event(
        signal,
        before=before,
        via=VIA_ASSISTED,
        reason=reason,
        actor_type="agent",
        actor_id=str(getattr(agent, "id", "") or signal.agent_id or ""),
        extra={
            "agent_name": getattr(agent, "name", ""),
            "owner_name": await owner_label(session, signal),
        },
    )
    session.add(event)
    signal.updated_at = datetime.utcnow()
    return json.loads(event.payload_json)


async def escalate_to_human(
    session: AsyncSession,
    signal: Signal,
    *,
    reason: str = "",
    via: str = "handoff_to_human",
    actor_type: str = "agent",
    actor_id: str = "",
    to: dict[str, Any] | None = None,
    hold_reason: str = ai_handling.REASON_HANDOFF,
    tenant: Tenant | None = None,
) -> dict[str, Any]:
    """Move the conversation from the agent to people (caller commits).

    Holds the conversation (manual) with ``hold_reason``, picks the owner via
    the escalation chain when the agent owned it (or a target is given), and
    leaves an internal system note. Returns ``{"owner", "recipients",
    "newly_held", "bounce_limited"}``.
    """
    from app.services.addressee import resolve_addressee
    from app.services.teams import get_team, team_user_ids

    tenant_id = signal.tenant_id
    before = owner_payload(signal)
    was_agent = signal.assignee_kind == "agent"

    bounce_limited = False
    limit = ai_handling.resolve_routing(await _tenant(session, signal, tenant)).bounce_limit
    if was_agent and limit and (await bounce_count(session, signal)) + 1 >= limit:
        bounce_limited = True
        hold_reason = ai_handling.REASON_BOUNCE

    newly_held = False
    if not ai_handling.is_held(signal) or (
        bounce_limited and (signal.ai_handling_reason or "") != ai_handling.REASON_BOUNCE
    ):
        signal.has_unread = True
        newly_held = ai_handling.hold_conversation(
            session, signal, reason=hold_reason, actor_type=actor_type, actor_id=actor_id, via=via
        )

    addressee = await resolve_addressee(
        session, tenant_id, agent_id=signal.agent_id, signal=signal, to=to
    )
    if was_agent or to is not None:
        if addressee.kind == "user" and addressee.user_id:
            set_owner(signal, "user", addressee.user_id)
        elif addressee.team_id:
            set_owner(signal, "team", addressee.team_id)
        session.add(signal)
    if addressee.kind == "user" and addressee.user_id:
        recipients = [addressee.user_id]
    else:
        team = await get_team(session, tenant_id, addressee.team_id) if addressee.team_id else None
        recipients = await team_user_ids(session, team) if team is not None else []

    if was_agent:
        session.add(
            _handover_event(
                signal,
                before=before,
                via=via,
                reason=reason,
                actor_type=actor_type,
                actor_id=actor_id,
                extra={"routed_by": addressee.routed_by, "bounce_limited": bounce_limited},
            )
        )
        label = await owner_label(session, signal)
        lang = await _lang(session, signal, tenant)
        await _add_system_note(
            session,
            signal,
            _escalation_copy(lang, owner=label, reason=reason, bounce_limited=bounce_limited),
            meta={"handover": "to_human", "via": via, "bounce_limited": bounce_limited},
        )
    signal.updated_at = datetime.utcnow()
    session.add(signal)
    return {
        "owner": owner_payload(signal),
        "recipients": recipients,
        "newly_held": newly_held,
        "bounce_limited": bounce_limited,
    }


async def hand_to_agent(
    session: AsyncSession,
    tenant: Tenant | None,
    signal: Signal,
    *,
    actor_type: str = "user",
    actor_id: str = "",
    via: str = "hand_back",
    agent: Any = None,
    by_user_id: UUID | None = None,
) -> bool:
    """Make the agent the owner when it may send on its own (caller commits).

    Releases any conversation hold first (an explicit hand back resolves
    take-over, handoff, escalation and bounce holds). Returns False, with the
    owner unchanged, when no agent may own the conversation: the agent then
    drafts for the current owner.
    """
    from app.services.routing import resolve_inbound_agent_for_signal

    if signal.channel in ("internal", "assistant"):
        return False
    if ai_handling.is_held(signal):
        ai_handling.release_conversation(
            session, signal, reason="hand_back", actor_type=actor_type, actor_id=actor_id, via=via
        )
    tenant = await _tenant(session, signal, tenant)
    if agent is None:
        agent = await resolve_inbound_agent_for_signal(session, signal)
    if not await agent_may_own(session, signal, agent=agent, tenant=tenant):
        return False
    if signal.assignee_kind == "agent" and signal.agent_id == agent.id:
        return True
    before = owner_payload(signal)
    set_owner(signal, "agent", agent.id, by_user_id=by_user_id)
    session.add(signal)
    session.add(
        _handover_event(
            signal,
            before=before,
            via=via,
            reason="",
            actor_type=actor_type,
            actor_id=actor_id,
            extra={"agent_name": getattr(agent, "name", "")},
        )
    )
    return True


async def apply_after_human_reply(
    session: AsyncSession,
    tenant: Tenant | None,
    signal: Signal,
    user_id: UUID,
    *,
    handback: bool | None = None,
    via: str = "reply",
) -> dict[str, Any]:
    """Settle owner and hold after a person sent a reply (caller commits).

    - A non-sticky hold (handoff, escalation, legacy assigned) is released:
      the person answered. Take-over and bounce holds stay unless the person
      explicitly hands back.
    - ``handback`` True/False is the composer's explicit choice; None follows
      the channel policy (``return_to_agent`` | ``keep_with_human`` | ``ask``,
      where ``ask`` without a choice keeps it with the person).
    - Return to the agent only happens when the agent may own the conversation
      and the bounce limit is not reached; otherwise the replying person owns it.
    """
    tenant = await _tenant(session, signal, tenant)
    account, _contact = await ai_handling.load_layers(session, signal.tenant_id, signal)
    policy = ai_handling.resolve_routing(tenant, account)
    reason = signal.ai_handling_reason or ""
    sticky = ai_handling.is_held(signal) and reason in ai_handling.STICKY_HOLD_REASONS
    before = owner_payload(signal)
    before_kind = signal.assignee_kind or "team"
    # The reply is out: the typing lock must not keep the agent at drafting.
    signal.human_composing_until = None

    if ai_handling.is_held(signal) and (not sticky or handback is True):
        ai_handling.release_conversation(
            session,
            signal,
            reason="hand_back" if handback is True else "human_replied",
            actor_type="user",
            actor_id=str(user_id),
            via=via,
        )

    if handback is None:
        setting = policy.effective["after_human_reply"]
        # Returns to the agent: agent- and team-owned conversations, and the
        # owner's own reply (the agent handed it to them and they answered).
        # A reply on a colleague's conversation leaves their ownership alone.
        own_reply = before_kind == "user" and signal.assigned_user_id == user_id
        wants_agent = (
            not sticky
            and setting == "return_to_agent"
            and (before_kind in ("agent", "team") or own_reply)
        )
    else:
        wants_agent = handback

    remember_human_owner(signal, "user", user_id)
    result: dict[str, Any] = {
        "handed_back": False,
        "policy": policy.effective["after_human_reply"],
        "owner_changed": False,
    }

    if wants_agent:
        from app.services.routing import resolve_inbound_agent_for_signal

        agent = await resolve_inbound_agent_for_signal(session, signal)
        if await agent_may_own(session, signal, agent=agent, tenant=tenant):
            # The bounce limit guards the automatic return; a person who
            # explicitly hands back has decided and is not bounced.
            if (
                handback is None
                and policy.bounce_limit
                and (await bounce_count(session, signal)) >= policy.bounce_limit
            ):
                set_owner(signal, "user", user_id, by_user_id=user_id)
                ai_handling.hold_conversation(
                    session,
                    signal,
                    reason=ai_handling.REASON_BOUNCE,
                    actor_type="system",
                    actor_id="",
                    via=via,
                )
                label = await owner_label(session, signal)
                await _add_system_note(
                    session,
                    signal,
                    _bounce_copy(await _lang(session, signal, tenant), owner=label),
                    meta={"handover": "bounce_limit", "via": via},
                )
                result["bounce_limited"] = True
            else:
                set_owner(signal, "agent", agent.id, by_user_id=user_id)
                session.add(
                    _handover_event(
                        signal,
                        before=before,
                        via=via,
                        reason="",
                        actor_type="user",
                        actor_id=str(user_id),
                        extra={
                            "agent_name": getattr(agent, "name", ""),
                            "policy": policy.effective["after_human_reply"],
                            "explicit": handback is not None,
                        },
                    )
                )
                result["handed_back"] = True
                result["owner_changed"] = True
                session.add(signal)
                return result

    # Keep with the person: the replier picks up a team- or agent-owned
    # conversation; a conversation already owned by another person stays theirs.
    if before_kind in ("team", "agent"):
        team_id = signal.assignee_team_id if before_kind == "team" else None
        set_owner(signal, "user", user_id, by_user_id=user_id)
        session.add(await picked_up_event(session, signal, user_id, team_id, via=via))
        if before_kind == "agent":
            session.add(
                _handover_event(
                    signal,
                    before=before,
                    via=via,
                    reason="",
                    actor_type="user",
                    actor_id=str(user_id),
                    extra={"policy": policy.effective["after_human_reply"], "explicit": handback is not None},
                )
            )
        result["owner_changed"] = True
    session.add(signal)
    return result


async def apply_reopen_policy(
    session: AsyncSession,
    tenant: Tenant | None,
    signal: Signal,
    *,
    account: Any = None,
    contact: Any = None,
) -> bool:
    """Owner of a conversation that a new customer message reopened (caller commits).

    ``same_owner`` keeps the owner; a stale person owner (no longer a member)
    falls back along the human chain. ``route_again`` routes like a new
    conversation (agent when autonomous, else contact owner / channel team).
    Returns True when the owner changed.
    """
    from app.services.ownership import _active_member, route_new_conversation

    tenant = await _tenant(session, signal, tenant)
    if account is None:
        account, loaded_contact = await ai_handling.load_layers(session, signal.tenant_id, signal)
        contact = contact or loaded_contact
    policy = ai_handling.resolve_routing(tenant, account)
    before = owner_payload(signal)
    if policy.effective["reopen_owner"] == "route_again":
        signal.assignee_kind = "team"
        signal.assigned_user_id = None
        signal.assignee_team_id = None
        await session.flush()
        await route_new_conversation(session, signal, tenant=tenant, account=account, contact=contact)
    elif signal.assignee_kind == "user" and not await _active_member(
        session, signal.tenant_id, signal.assigned_user_id
    ):
        kind, owner_id = await human_fallback_owner(session, signal, contact=contact)
        set_owner(signal, kind, owner_id)
    changed = owner_payload(signal) != before
    if changed:
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="auto_assigned",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps(
                    {**owner_payload(signal), "reason": "reopened", "policy": policy.effective["reopen_owner"]}
                ),
            )
        )
    return changed
