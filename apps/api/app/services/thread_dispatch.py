"""Hand a conversation to an agent or a team: @agent / @team mentions and assign-with-message.

Mentions use the same inline markup as people mentions:
``@[Billing](agent:<uuid>)`` and ``@[Support](team:<uuid>)``.

- An agent target runs that agent on the thread with the note as instruction;
  its answer lands as an internal note.
- A department target starts its point of contact, which handles it or asks a
  crew member. Without one, the people in the department get a tier 1 notice
  and the first to respond picks it up.
- The organization root starts the lead (its point of contact), which picks
  the department or agent and delegates.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.signal import Signal, SignalEvent, SignalMessage

logger = logging.getLogger(__name__)

ENTITY_MENTION_PATTERN = re.compile(r"@\[([^\]]+)\]\((agent|team):([0-9a-fA-F-]{36})\)")

NOTE_INSTRUCTION = (
    "Help a teammate on this conversation: answer their question, look "
    "things up, or propose next steps. Reply as a concise internal note "
    "for the team (the customer will not see it). Do not repeat these "
    "instructions."
)
LEAD_PICK_INSTRUCTION = (
    "A teammate addressed the whole organization. You are its point of contact. "
    "Pick the department or agent that fits this conversation best and ask it "
    "with ask_agent, or hand it over with handoff_to when that department "
    "should own it; say in one line who picks it up and why. Handle it "
    "yourself when you fit best."
)

CONTACT_PICK_INSTRUCTION = (
    "A teammate addressed your department. You are its point of contact. "
    "Handle it yourself, or ask the crew member whose focus fits with "
    "ask_agent; say in one line who picks it up and why."
)


async def addressed_agent(session: AsyncSession, tenant_id: UUID, team: Any) -> tuple[Agent | None, str]:
    """The agent that picks up when a department is addressed, with its instruction.

    The point of contact of the department; for the organization the lead.
    """
    from app.models.team import is_root_department

    if is_root_department(team):
        from app.services.lead_agent import get_lead_agent

        return await get_lead_agent(session, tenant_id), LEAD_PICK_INSTRUCTION
    from app.services.department_access import department_contact

    contact, _implicit = await department_contact(session, tenant_id, team.id)
    return contact, CONTACT_PICK_INSTRUCTION


def entity_mentions(body_text: str) -> list[tuple[str, UUID]]:
    """``[(kind, id)]`` for agent and team mentions, in order, without duplicates."""
    seen: list[tuple[str, UUID]] = []
    for _, kind, raw in ENTITY_MENTION_PATTERN.findall(body_text or ""):
        try:
            ref = (kind, UUID(raw))
        except ValueError:
            continue
        if ref not in seen:
            seen.append(ref)
    return seen


def plain_mentions(body_text: str) -> str:
    return ENTITY_MENTION_PATTERN.sub(lambda m: f"@{m.group(1)}", body_text or "")


async def run_agent_note(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal: Signal,
    agent: Agent,
    *,
    operator_text: str = "",
    user_role: str = "member",
    base_instruction: str = NOTE_INSTRUCTION,
) -> SignalMessage:
    """Run ``agent`` on the thread; its answer becomes an internal note (commits)."""
    from app.services.assistant_threads import signal_chat_history
    from app.services.chat_runtime import build_agent_loop
    from app.services.workforce_runtime import mark_agent_activity

    history = await signal_chat_history(session, signal.id)
    instruction = base_instruction
    operator = (operator_text or "").strip()
    if operator:
        instruction += f"\nTeammate's request: {operator}"
    await mark_agent_activity(
        session,
        agent,
        status="working",
        summary=(signal.subject or "Helping")[:200],
        signal_id=signal.id,
    )
    try:
        # A note is read by the team, never by the customer: chat style, one card.
        loop = build_agent_loop(
            session,
            tenant_id=tenant_id,
            user_id=user_id,
            agent=agent,
            signal_id=signal.id,
            trust="operator",
            user_role=user_role,
            reply_mode="chat",
            surface="mention_note",
        )
        reply_text, tokens = await loop.run_chat([*history, {"role": "user", "content": instruction}])
        turn = loop.turn
        text = ((turn.full_text if turn else "") or reply_text or "").strip() or "No output produced."
        from app.services.agent.turn_persist import touch_agent_activity
        from app.services.chat_runtime import post_message

        message = await post_message(
            session,
            signal,
            content=text,
            role="assistant",
            trust="operator",
            author_agent_id=agent.id,
            kind="internal_note",
            metadata={
                "usage": tokens,
                "activity": turn.all_activity() if turn else [],
                "turn_id": turn.stream_id if turn else None,
                "invoked_by_user_id": str(user_id),
                "agent_name": agent.name,
            },
        )
        await touch_agent_activity(session, agent.id)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="agent_invoked",
                actor_type="user",
                actor_id=str(user_id),
                payload_json=json.dumps({"agent_id": str(agent.id), "agent_name": agent.name}),
            )
        )
        await session.commit()
        await session.refresh(message)
        return message
    finally:
        try:
            await mark_agent_activity(session, agent, status="standby")
        except Exception:  # noqa: BLE001
            logger.exception("Failed to reset agent runtime after note on %s", signal.id)


def _schedule_agent_note(
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    agent_id: UUID,
    *,
    operator_text: str,
    user_role: str,
    base_instruction: str,
) -> None:
    async def _run() -> None:
        from app.db.session import async_session_factory

        async with async_session_factory() as bg:
            signal = await bg.get(Signal, signal_id)
            agent = await bg.get(Agent, agent_id)
            if signal is None or agent is None or signal.tenant_id != tenant_id:
                return
            await run_agent_note(
                bg,
                tenant_id,
                user_id,
                signal,
                agent,
                operator_text=operator_text,
                user_role=user_role,
                base_instruction=base_instruction,
            )

    try:
        task = asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        logger.warning("No running loop to dispatch agent %s on %s", agent_id, signal_id)
        return
    task.add_done_callback(
        lambda t: logger.exception("Agent dispatch failed for %s", signal_id, exc_info=t.exception())
        if t.exception()
        else None
    )


async def _start_agent(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal: Signal,
    agent: Agent,
    *,
    operator_text: str,
    user_role: str,
    base_instruction: str = NOTE_INSTRUCTION,
) -> None:
    """Run inline under mock execution (tests share one session); background otherwise."""
    from app.config import get_settings

    if get_settings().bokito_mock_execution:
        await run_agent_note(
            session,
            tenant_id,
            user_id,
            signal,
            agent,
            operator_text=operator_text,
            user_role=user_role,
            base_instruction=base_instruction,
        )
        return
    _schedule_agent_note(
        tenant_id,
        user_id,
        signal.id,
        agent.id,
        operator_text=operator_text,
        user_role=user_role,
        base_instruction=base_instruction,
    )


async def _active_agent(session: AsyncSession, tenant_id: UUID, agent_id: UUID) -> Agent | None:
    agent = await session.get(Agent, agent_id)
    if agent is None or agent.tenant_id != tenant_id or not agent.is_active:
        return None
    return agent


async def _channel_account(session: AsyncSession, signal: Signal):
    from app.models.channel import ChannelAccount

    if not signal.channel_account_id:
        return None
    return await session.get(ChannelAccount, signal.channel_account_id)


async def dispatch_to(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    kind: str,
    target_id: UUID,
    author_user_id: UUID,
    author_name: str,
    text: str,
    user_role: str = "member",
) -> dict[str, Any]:
    """Route one agent or team target; returns what happened for the caller."""
    from app.services.channel_access import agent_can_handle
    from app.services.notify import TIER_NOW, notify
    from app.services.org_routing import route_to_node
    from app.services.teams import get_team

    account = await _channel_account(session, signal)
    if kind == "agent":
        agent = await _active_agent(session, tenant_id, target_id)
        if agent is None or not await agent_can_handle(session, account, agent.id):
            return {"kind": "agent", "id": str(target_id), "dispatched": False}
        from app.services.participant_turns import request_participant_turn
        from app.services.participants import ensure_participant

        await ensure_participant(
            session,
            signal,
            kind="agent",
            ref_id=agent.id,
            role="member",
            invited_by_kind="user",
            invited_by_id=author_user_id,
            joined_via="mention",
        )
        # @agent: invite onto the roster and give them the floor (not only a note).
        turn = await request_participant_turn(
            session,
            signal,
            member_kind="agent",
            member_ref_id=agent.id,
            prompt=plain_mentions(text)[:2000],
            requested_by_kind="user",
            requested_by_id=author_user_id,
            run=True,
        )
        if not turn.get("ok"):
            # Avoid a stale floor chip when the turn queue fails.
            signal.active_turn_json = None
            session.add(signal)
            await _start_agent(
                session,
                tenant_id,
                author_user_id,
                signal,
                agent,
                operator_text=text,
                user_role=user_role,
            )
        return {
            "kind": "agent",
            "id": str(agent.id),
            "dispatched": True,
            "turn": turn,
        }

    team = await get_team(session, tenant_id, target_id)
    if team is None:
        return {"kind": "department", "id": str(target_id), "dispatched": False}
    route = await route_to_node(
        session, tenant_id, team, account=account, signal=signal, skip_user=author_user_id
    )
    via = {"via_department_id": str(route.node.id)} if route.walked_up and route.node else {}
    if route.agent is not None:
        await _start_agent(
            session,
            tenant_id,
            author_user_id,
            signal,
            route.agent,
            operator_text=text,
            user_role=user_role,
            base_instruction=route.instruction,
        )
        return {
            "kind": "department",
            "id": str(team.id),
            "dispatched": True,
            "agent_id": str(route.agent.id),
            **via,
        }
    if route.people:
        await notify(
            session,
            tenant_id,
            kind="mention",
            recipients=route.people,
            title=f"{author_name or 'A teammate'} asked {team.name} in {signal.subject or 'a conversation'}",
            body=plain_mentions(text)[:300],
            tier=TIER_NOW,
            category="mentions",
            signal_id=signal.id,
        )
    return {
        "kind": "department",
        "id": str(team.id),
        "dispatched": bool(route.people),
        "notified": len(route.people),
        **via,
    }


async def dispatch_mentions(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    body_text: str,
    author_user_id: UUID,
    author_name: str = "",
    user_role: str = "member",
    follow_holder: bool = True,
) -> list[dict[str, Any]]:
    """Act on @agent and @team mentions in a note or reply.

    Multi-agent (or agent+human) bodies start one nestable handoff session
    with a single opener instead of N parallel floors.
    """
    from app.services.pass_stick import pass_stick

    moved = await pass_stick(
        session,
        signal,
        body_text=body_text,
        author_kind="user",
        author_id=author_user_id,
        author_name=author_name,
        wake_default=False,
        channel_agent_id=signal.agent_id,
        follow_holder=follow_holder,
    )
    if moved.get("action") in ("give", "clear") or moved.get("reason") == "human_only":
        return [
            {
                "kind": "stick",
                "dispatched": moved.get("action") == "give",
                "action": moved.get("action"),
                "holder_id": moved.get("holder_id"),
                "reason": moved.get("reason"),
            }
        ]

    results = []
    for kind, target_id in entity_mentions(body_text):
        results.append(
            await dispatch_to(
                session,
                tenant_id,
                signal,
                kind=kind,
                target_id=target_id,
                author_user_id=author_user_id,
                author_name=author_name,
                text=body_text,
                user_role=user_role,
            )
        )
    return results
