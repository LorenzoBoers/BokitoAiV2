"""Who answers a team message that tags nobody.

The default is the agent that spoke last in the conversation, then the
conversation's own agent. With several agents in the conversation, one short
model call may pick another agent, but only when it is sure; any doubt,
timeout or error keeps the default.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.signal import Signal, SignalMessage
from app.models.signal_participant import SignalParticipant

logger = logging.getLogger(__name__)

ROUTER_TIMEOUT_S = 2.0
MIN_CONFIDENCE = 0.75
_RECENT_LINES = 8
_JSON = re.compile(r"\{.*\}", re.DOTALL)

_PROMPT = """\
A colleague wrote a message to the team in a work chat. Pick the one agent
that should answer it. Prefer the default agent unless the message clearly
belongs to another agent's job.

Agents:
{agents}

Default agent: {default_id}

Recent conversation:
{recent}

New message:
{message}

Answer with JSON only: {{"agent_id": "<id from the list>", "confidence": <0..1>}}
"""


@dataclass
class Pick:
    agent_id: UUID | None
    reason: str


async def _candidates(session: AsyncSession, signal: Signal) -> list[Agent]:
    ids = list(
        (
            await session.execute(
                select(SignalParticipant.ref_id).where(
                    SignalParticipant.signal_id == signal.id,
                    SignalParticipant.kind == "agent",
                    SignalParticipant.left_at.is_(None),
                )
            )
        ).scalars().all()
    )
    speakers = (
        await session.execute(
            select(SignalMessage.author_agent_id)
            .where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.author_agent_id.is_not(None),
                SignalMessage.kind == "agent_message",
            )
            .order_by(SignalMessage.seq.desc())
            .limit(20)
        )
    ).scalars().all()
    ids.extend(speakers)
    if signal.agent_id:
        ids.append(signal.agent_id)
    agents: list[Agent] = []
    for agent_id in dict.fromkeys(ids):
        agent = await session.get(Agent, agent_id)
        if agent is not None and agent.tenant_id == signal.tenant_id and agent.is_active:
            agents.append(agent)
    return agents


async def _last_speaker(session: AsyncSession, signal_id: UUID, among: set[UUID]) -> UUID | None:
    from app.services.signal_threads import last_agent_author

    author = await last_agent_author(session, signal_id)
    return author if author in among else None


async def _recent(session: AsyncSession, signal_id: UUID, names: dict[UUID, str]) -> str:
    from app.services.signals import message_plain_text

    rows = (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == signal_id,
                SignalMessage.kind.notin_(("system_event", "internal_note")),
            )
            .order_by(SignalMessage.seq.desc())
            .limit(_RECENT_LINES)
        )
    ).scalars().all()
    lines = []
    for row in reversed(rows):
        who = names.get(row.author_agent_id) if row.author_agent_id else "Colleague"
        lines.append(f"{who or 'Agent'}: {message_plain_text(row)[:300]}")
    return "\n".join(lines) or "(empty)"


async def _ask_model(
    session: AsyncSession,
    signal: Signal,
    agents: list[Agent],
    default_id: UUID,
    text: str,
) -> tuple[UUID | None, float]:
    from app.services.agent.llm import get_chat_provider
    from app.services.model_resolution import record_usage, resolve_model_call

    resolved = await resolve_model_call(session, signal.tenant_id, kind="chat")
    if not resolved.live:
        return None, 0.0
    names = {agent.id: agent.name for agent in agents}
    roster = "\n".join(
        f"- {agent.id}: {agent.name} ({agent.job_title or agent.role or 'agent'}) "
        f"{(agent.description or '')[:200]}"
        for agent in agents
    )
    prompt = _PROMPT.format(
        agents=roster,
        default_id=default_id,
        recent=await _recent(session, signal.id, names),
        message=text[:1500],
    )
    llm = get_chat_provider(resolved.provider_type, resolved.api_key, resolved.base_url or None)
    response = await llm.chat([{"role": "user", "content": prompt}], model=resolved.model_id, max_tokens=60)
    usage = response.get("usage") or {}
    await record_usage(
        session,
        signal.tenant_id,
        resolved,
        tokens_in=int(usage.get("input_tokens") or 0),
        tokens_out=int(usage.get("output_tokens") or 0),
        scope="chat",
        scope_id=str(signal.id),
        call_type="team_router",
    )
    raw = "".join(
        block.get("text") or ""
        for block in response.get("content") or []
        if isinstance(block, dict) and block.get("type") == "text"
    )
    match = _JSON.search(raw)
    if not match:
        return None, 0.0
    data = json.loads(match.group(0))
    try:
        picked = UUID(str(data.get("agent_id") or ""))
    except ValueError:
        return None, 0.0
    if picked not in names:
        return None, 0.0
    return picked, float(data.get("confidence") or 0.0)


async def pick_responder(session: AsyncSession, signal: Signal, text: str) -> Pick:
    """The agent that answers an untagged team message, and why."""
    agents = await _candidates(session, signal)
    if not agents:
        return Pick(None, "no_agent")
    if len(agents) == 1:
        return Pick(agents[0].id, "only_agent")
    among = {agent.id for agent in agents}
    last = await _last_speaker(session, signal.id, among)
    default_id = last or (signal.agent_id if signal.agent_id in among else agents[0].id)
    default_reason = "last_speaker" if last else "owner"
    try:
        picked, confidence = await asyncio.wait_for(
            _ask_model(session, signal, agents, default_id, text), timeout=ROUTER_TIMEOUT_S
        )
    except Exception:  # noqa: BLE001
        logger.info("team router fell back to the default for %s", signal.id, exc_info=True)
        return Pick(default_id, default_reason)
    if picked is not None and picked != default_id and confidence >= MIN_CONFIDENCE:
        return Pick(picked, "router")
    return Pick(default_id, default_reason)
