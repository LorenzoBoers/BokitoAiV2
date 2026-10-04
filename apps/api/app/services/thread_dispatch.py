"""Hand a conversation to an agent or a team: @agent / @team mentions and assign-with-message.

Mentions use the same inline markup as people mentions:
``@[Billing](agent:<uuid>)`` and ``@[Support](team:<uuid>)``.

- An agent target runs that agent on the thread with the note as instruction;
  its answer lands as an internal note.
- A team target follows the team's pickup: ``agent_first`` runs the first agent
  member that may handle the channel; otherwise the people in the team get a
  tier 1 notice and the first to respond picks it up.
- The system team All agents lets the lead agent pick and delegate.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime
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
    "A teammate addressed all agents. Pick the company agent that fits this "
    "conversation best and hand it over with delegate_to_agent, saying in one "
    "line who picks it up and why. Handle it yourself when you fit best."
)


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
    from app.gateway.publish import publish_signal_message
    from app.services.agent.loop import AgentLoop
    from app.services.assistant_threads import signal_chat_history

    from app.services.workforce_runtime import mark_agent_activity

    history = await signal_chat_history(session, signal.id)
    instruction = base_instruction
    operator = (operator_text or "").strip()
    if operator:
        instruction += f"\nTeammate's request: {operator}"
    await mark_agent_activity(
        session,
        agent,
        status="active",
        summary=(signal.subject or "Helping")[:200],
    )
    try:
        loop = AgentLoop(session, tenant_id, user_id, agent=agent, signal_id=signal.id, user_role=user_role)
        reply_text, tokens = await loop.run_chat([*history, {"role": "user", "content": instruction}])
        text = (reply_text or "").strip() or "No output produced."
        now = datetime.utcnow()
        message = SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant_id,
            kind="internal_note",
            direction="internal",
            role="assistant",
            author_agent_id=agent.id,
            from_address="",
            to_addresses="",
            subject=signal.subject,
            body_text=text,
            body_preview=text[:200],
            body_html=f"<p>{text}</p>",
            metadata_json=json.dumps(
                {
                    "usage": tokens,
                    "steps": list(loop.trace_steps),
                    "invoked_by_user_id": str(user_id),
                    "agent_name": agent.name,
                }
            ),
            received_at=now,
        )
        session.add(message)
        signal.updated_at = now
        session.add(signal)
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
        await publish_signal_message(signal, message)
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
    from app.models.team import TEAM_KIND_AGENTS
    from app.services.channel_access import agent_can_handle
    from app.services.notify import TIER_NOW, notify
    from app.services.teams import get_team, team_agent_ids, team_user_ids

    account = await _channel_account(session, signal)
    if kind == "agent":
        agent = await _active_agent(session, tenant_id, target_id)
        if agent is None or not await agent_can_handle(session, account, agent.id):
            return {"kind": "agent", "id": str(target_id), "dispatched": False}
        await _start_agent(
            session, tenant_id, author_user_id, signal, agent, operator_text=text, user_role=user_role
        )
        return {"kind": "agent", "id": str(agent.id), "dispatched": True}

    team = await get_team(session, tenant_id, target_id)
    if team is None:
        return {"kind": "team", "id": str(target_id), "dispatched": False}
    if team.kind == TEAM_KIND_AGENTS:
        from app.services.lead_agent import get_lead_agent

        lead = await get_lead_agent(session, tenant_id)
        if lead is not None and lead.is_active:
            await _start_agent(
                session,
                tenant_id,
                author_user_id,
                signal,
                lead,
                operator_text=text,
                user_role=user_role,
                base_instruction=LEAD_PICK_INSTRUCTION,
            )
            return {"kind": "team", "id": str(team.id), "dispatched": True, "agent_id": str(lead.id)}
        return {"kind": "team", "id": str(team.id), "dispatched": False}
    if team.pickup == "agent_first":
        for agent_id in await team_agent_ids(session, team):
            agent = await _active_agent(session, tenant_id, agent_id)
            if agent is not None and await agent_can_handle(session, account, agent.id):
                await _start_agent(
                    session, tenant_id, author_user_id, signal, agent, operator_text=text, user_role=user_role
                )
                return {"kind": "team", "id": str(team.id), "dispatched": True, "agent_id": str(agent.id)}
    people = [uid for uid in await team_user_ids(session, team) if uid != author_user_id]
    if people:
        await notify(
            session,
            tenant_id,
            kind="mention",
            recipients=people,
            title=f"{author_name or 'A teammate'} asked {team.name} in {signal.subject or 'a conversation'}",
            body=plain_mentions(text)[:300],
            tier=TIER_NOW,
            category="mentions",
            signal_id=signal.id,
        )
    return {"kind": "team", "id": str(team.id), "dispatched": bool(people), "notified": len(people)}


async def dispatch_mentions(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    body_text: str,
    author_user_id: UUID,
    author_name: str = "",
    user_role: str = "member",
) -> list[dict[str, Any]]:
    """Act on @agent and @team mentions in a note or reply."""
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
