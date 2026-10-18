"""Nestable multi-agent handoff sessions: pick one opener, baton to nested subsets.

A session starts when a message addresses ≥1 agent and ≥2 invitees (after @team
expand). Only the opener runs; they may hand off as their last action (depth ≤5).
Human interrupt runs on Send (or customer inbound), not on draft keystrokes.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.signal import Signal, SignalEvent

logger = logging.getLogger(__name__)

MAX_HANDOFF_DEPTH = 5

_ROLE_RANK = {
    "orchestrator": 100,
    "orchestra": 100,
    "lead": 90,
    "po": 80,
    "specialist": 50,
    "module_specialist": 50,
    "assistant": 30,
    "coding": 20,
}

_TITLE_HINTS = (
    ("orchestrator", 40),
    ("lead", 35),
    ("hoofd", 30),
    ("manager", 25),
    ("specialist", 15),
)


def _parse_handoff(signal: Signal) -> dict[str, Any]:
    raw = getattr(signal, "handoff_session_json", None) or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def _write_handoff(signal: Signal, state: dict[str, Any] | None) -> None:
    signal.handoff_session_json = json.dumps(state or {})


def get_handoff_session(signal: Signal) -> dict[str, Any] | None:
    raw = _parse_handoff(signal)
    return raw if raw.get("id") else None


def serialize_handoff_session(signal: Signal) -> dict[str, Any] | None:
    session = get_handoff_session(signal)
    if not session or session.get("status") in ("done", "interrupted"):
        return None
    return session


async def expand_invitees(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    body_text: str,
    extra_agent_ids: list[UUID] | None = None,
) -> dict[str, Any]:
    """Expand agent/team mentions into ordered agent + human invitee lists.

    ``extra_agent_ids`` are the Ask-tab audience. They join the mention list
    without being written into the message body.
    """
    from app.models.team import is_root_department
    from app.services.teams import get_team, team_agent_ids, team_user_ids
    from app.services.thread_dispatch import entity_mentions

    agents: list[Agent] = []
    agent_ids: list[UUID] = []
    humans: list[dict[str, Any]] = []
    human_ids: list[str] = []

    for kind, target_id in entity_mentions(body_text):
        if kind == "agent":
            agent = await session.get(Agent, target_id)
            if agent is None or agent.tenant_id != tenant_id or not agent.is_active:
                continue
            if agent.id in agent_ids:
                continue
            agent_ids.append(agent.id)
            agents.append(agent)
            continue
        if kind != "department":
            continue
        team = await get_team(session, tenant_id, target_id)
        if team is None:
            continue
        for aid in await team_agent_ids(session, team):
            agent = await session.get(Agent, aid)
            if agent is None or agent.tenant_id != tenant_id or not agent.is_active:
                continue
            if agent.id in agent_ids:
                continue
            agent_ids.append(agent.id)
            agents.append(agent)
        if not is_root_department(team):
            for uid in await team_user_ids(session, team):
                key = str(uid)
                if key in human_ids:
                    continue
                human_ids.append(key)
                humans.append({"kind": "user", "id": key})

    # People mentions (@[Name](user:id)) — optional secondary path.
    for match in re.finditer(
        r"@\[([^\]]+)\]\(user:([^)]+)\)", body_text or "", flags=re.IGNORECASE
    ):
        key = str(match.group(2)).strip()
        if not key or key in human_ids:
            continue
        human_ids.append(key)
        humans.append({"kind": "user", "id": key, "name": match.group(1)})

    for raw_id in extra_agent_ids or []:
        try:
            target_id = raw_id if isinstance(raw_id, UUID) else UUID(str(raw_id))
        except ValueError:
            continue
        if target_id in agent_ids:
            continue
        agent = await session.get(Agent, target_id)
        if agent is None or agent.tenant_id != tenant_id or not agent.is_active:
            continue
        agent_ids.append(agent.id)
        agents.append(agent)

    return {
        "agents": agents,
        "agent_ids": agent_ids,
        "humans": humans,
        "human_ids": human_ids,
        "total": len(agent_ids) + len(human_ids),
    }


def _hierarchy_score(agent: Agent) -> int:
    role = (agent.role or "").strip().lower()
    score = _ROLE_RANK.get(role, 10)
    title = (getattr(agent, "job_title", None) or "").strip().lower()
    for hint, bonus in _TITLE_HINTS:
        if hint in title:
            score += bonus
    desc = (getattr(agent, "description", None) or getattr(agent, "system_prompt", None) or "")
    desc_l = str(desc).lower()
    if "orchestrat" in desc_l:
        score += 20
    if "lead" in desc_l:
        score += 10
    return score


_NEGATION = re.compile(
    r"\b(geen|niet|no|not|don't|dont|without|zonder|niet\s+met)\b",
    re.IGNORECASE,
)


def _name_needles(name: str) -> list[str]:
    parts = [part for part in re.split(r"\s+", (name or "").strip()) if part]
    if not parts:
        return []
    needles = [" ".join(parts).lower()]
    needles.extend(part.lower() for part in parts if len(part) > 3)
    if len(parts) >= 2:
        needles.append(f"{parts[-2]} {parts[-1]}".lower())
    # Longer needles first so "test agent" wins over a short token.
    return sorted(set(needles), key=len, reverse=True)


def _refused(text: str, agent: Agent) -> bool:
    low = (text or "").lower()
    if not low:
        return False
    for needle in _name_needles(agent.name or ""):
        start = 0
        while True:
            at = low.find(needle, start)
            if at < 0:
                break
            window = low[max(0, at - 32) : at]
            if _NEGATION.search(window):
                return True
            start = at + len(needle)
    return False


def _named_in_order(agents: list[Agent], text: str) -> list[Agent]:
    low = (text or "").lower()
    hits: list[tuple[int, Agent]] = []
    for agent in agents:
        if _refused(text, agent):
            continue
        best: int | None = None
        for needle in _name_needles(agent.name or ""):
            at = low.find(needle)
            if at >= 0 and (best is None or at < best):
                best = at
        if best is not None:
            hits.append((best, agent))
    hits.sort(key=lambda item: item[0])
    return [agent for _, agent in hits]


def _fallback_speaker(
    agents: list[Agent],
    *,
    mention_order: list[UUID] | None,
    channel_agent_id: UUID | None,
) -> Agent | None:
    if not agents:
        return None
    by_id = {agent.id: agent for agent in agents}
    for mid in mention_order or []:
        picked = by_id.get(mid)
        if picked is not None:
            return picked
    if channel_agent_id is not None:
        picked = by_id.get(channel_agent_id)
        if picked is not None:
            return picked
    return sorted(agents, key=lambda agent: (-_hierarchy_score(agent), agent.name or ""))[0]


def choose_speaker(
    agents: list[Agent],
    text: str,
    *,
    mention_order: list[UUID] | None = None,
    channel_agent_id: UUID | None = None,
) -> Agent | None:
    """Who should answer. None when several candidates remain and none is named.

    A refused name drops out ("geen test agent"). One remaining name is asked
    to act, so "@Extra tell @Bokito" still opens as Extra. An unnamed tie is
    left for a short model pick, then mention order and the thread agent.
    """
    if not agents:
        return None
    pool = [agent for agent in agents if not _refused(text, agent)] or list(agents)
    if len(pool) == 1:
        return pool[0]
    named = _named_in_order(pool, text)
    if named:
        return named[0]
    return None


def pick_opener(
    agents: list[Agent],
    *,
    channel_agent_id: UUID | None = None,
    mention_order: list[UUID] | None = None,
    text: str = "",
) -> Agent | None:
    """Sync opener choice. Ambiguous text falls back without a model call."""
    picked = choose_speaker(
        agents,
        text,
        mention_order=mention_order,
        channel_agent_id=channel_agent_id,
    )
    if picked is not None:
        return picked
    return _fallback_speaker(
        agents,
        mention_order=mention_order,
        channel_agent_id=channel_agent_id,
    )


def _choice_text(result: dict[str, Any]) -> str:
    content = result.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict) and block.get("type") in (None, "text"):
                parts.append(str(block.get("text") or ""))
        return " ".join(parts)
    return ""


async def resolve_speaker(
    agents: list[Agent],
    text: str,
    *,
    mention_order: list[UUID] | None = None,
    channel_agent_id: UUID | None = None,
) -> Agent | None:
    """choose_speaker, then one no-tool completion, then mention order / thread agent."""
    picked = choose_speaker(
        agents,
        text,
        mention_order=mention_order,
        channel_agent_id=channel_agent_id,
    )
    if picked is not None or len(agents) < 2:
        return picked or _fallback_speaker(
            agents,
            mention_order=mention_order,
            channel_agent_id=channel_agent_id,
        )
    pool = [agent for agent in agents if not _refused(text, agent)] or list(agents)
    try:
        from app.services.agent.llm import get_llm_provider

        lines = "\n".join(
            f"{agent.id} | {agent.name} | {(getattr(agent, 'job_title', None) or agent.role or '').strip()}"
            for agent in pool
        )
        result = await get_llm_provider().chat(
            [
                {
                    "role": "user",
                    "content": (
                        "Pick who should answer the human. Reply with only the id.\n"
                        f"Candidates:\n{lines}\n\nHuman:\n{(text or '')[:1500]}"
                    ),
                }
            ],
            tools=None,
            max_tokens=40,
        )
        raw = _choice_text(result)
        by_id = {str(agent.id): agent for agent in pool}
        for agent_id, agent in by_id.items():
            if agent_id in raw:
                return agent
    except Exception:  # noqa: BLE001
        logger.debug("speaker route failed", exc_info=True)
    return _fallback_speaker(
        pool,
        mention_order=mention_order,
        channel_agent_id=channel_agent_id,
    )


def _opener_context(
    opener: Agent,
    *,
    co_agents: list[Agent],
    humans: list[dict[str, Any]],
    depth: int,
    prompt: str,
    original_request: str = "",
) -> str:
    peers = []
    for a in co_agents:
        if a.id == opener.id:
            continue
        title = (getattr(a, "job_title", None) or a.role or "").strip()
        peers.append(f"- {a.name} (agent{', ' + title if title else ''})")
    for h in humans:
        peers.append(f"- user:{h.get('id')} (human)")
    peer_block = "\n".join(peers) or "- (none)"
    depth_note = (
        f"You are at handoff depth {depth} of {MAX_HANDOFF_DEPTH}. "
        "You may still answer and use tools, but you must NOT start another nested handoff — "
        "finish yourself or ask a human."
        if depth >= MAX_HANDOFF_DEPTH
        else (
            f"Handoff depth {depth} of {MAX_HANDOFF_DEPTH}. "
            "You may hand off to one or more co-invitees or newly tagged agents as your "
            "**last** action (tag them and stop). Do not hand off mid-tool chain."
        )
    )
    request = (prompt or "").strip()[:2000]
    original = (original_request or "").strip()[:2000]
    if original and original not in request:
        request = (
            f"{request}\n\n"
            "Original request from the human (answer this; do not ask them to repeat it):\n"
            f"{original}"
        )
    if depth > 1:
        role = (
            f"You are {opener.name}. Another agent brought you into this conversation. "
            "The human tagged you or asked for you. Answer them directly."
        )
    else:
        role = (
            f"You are {opener.name}. You speak first. Answer the human directly.\n"
            "The others below were included in this message. Involve one only when "
            "they should answer instead of you."
        )
    return (
        f"## Handoff\n"
        f"{role}\n"
        f"Others in this message:\n{peer_block}\n\n"
        f"{depth_note}\n"
        "If you hand off, one short line that includes the human's actual request, "
        "tag them, then stop. Do not ask them to ask the human what the question was. "
        "You will not be asked to summarize their reply.\n"
        f"Request: {request}\n"
    )


async def start_handoff_session(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    body_text: str,
    author_user_id: UUID | None = None,
    author_name: str = "",
    user_role: str = "member",
    depth: int = 1,
    parent_id: str | None = None,
    channel_agent_id: UUID | None = None,
    requested_by_kind: str | None = None,
    requested_by_id: UUID | None = None,
    defer_peer: bool | None = None,
    extra_agent_ids: list[UUID] | None = None,
    original_request: str = "",
) -> dict[str, Any] | None:
    """Start a handoff when ≥1 agent and ≥2 invitees; else return None (caller falls through).

    Nested batons pass ``requested_by_kind="agent"`` + ``defer_peer=False`` so the
    peer runs immediately and usage is not attributed to an agent UUID as a user.
    """
    from app.services.participant_turns import request_participant_turn

    invitees = await expand_invitees(
        session,
        tenant_id,
        signal,
        body_text,
        extra_agent_ids=extra_agent_ids,
    )
    agents: list[Agent] = invitees["agents"]
    humans: list[dict[str, Any]] = invitees["humans"]
    if not agents:
        return None
    if invitees["total"] < 2 and depth <= 1:
        # Single agent mention — keep classic one-floor path.
        return None

    opener = await resolve_speaker(
        agents,
        body_text,
        channel_agent_id=channel_agent_id or signal.agent_id,
        mention_order=invitees["agent_ids"],
    )
    if opener is None:
        return None

    rb_kind = requested_by_kind or ("user" if author_user_id else "system")
    rb_id = requested_by_id if requested_by_id is not None else author_user_id

    session_id = str(uuid.uuid4())
    state = {
        "id": session_id,
        "status": "open",
        "depth": depth,
        "parent_id": parent_id,
        "opener_id": str(opener.id),
        "opener_name": opener.name,
        "agent_ids": [str(a.id) for a in agents],
        "human_ids": [h["id"] for h in humans],
        "started_at": datetime.utcnow().isoformat(),
        "prompt": ((original_request or body_text) or "")[:2000],
    }
    _write_handoff(signal, state)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="handoff_session_started",
            actor_type=rb_kind if rb_kind in ("user", "agent", "system") else "system",
            actor_id=str(rb_id or ""),
            payload_json=json.dumps(state),
        )
    )
    await session.flush()

    # Notify humans (non-blocking path reused via dispatch for people-only teams).
    if humans and rb_kind == "user":
        try:
            from app.services.notify import TIER_NOW, notify

            await notify(
                session,
                tenant_id,
                kind="mention",
                recipients=[UUID(h["id"]) for h in humans if _is_uuid(h["id"])],
                title=f"{author_name or 'A teammate'} involved you with {opener.name}",
                body=(body_text or "")[:300],
                tier=TIER_NOW,
                category="mentions",
                signal_id=signal.id,
            )
        except Exception:  # noqa: BLE001
            logger.debug("handoff human notify failed", exc_info=True)

    prompt = _opener_context(
        opener,
        co_agents=agents,
        humans=humans,
        depth=depth,
        prompt=body_text,
        original_request=original_request,
    )
    turn = await request_participant_turn(
        session,
        signal,
        member_kind="agent",
        member_ref_id=opener.id,
        prompt=prompt,
        requested_by_kind=rb_kind,
        requested_by_id=rb_id,
        run=True,
        enqueue=True,
        defer_peer=defer_peer,
    )
    return {"ok": True, "handoff": state, "turn": turn, "opener_id": str(opener.id)}


async def nest_handoff(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    body_text: str,
    from_agent_id: UUID,
    user_role: str = "member",
) -> dict[str, Any]:
    """Start a nested handoff from an opener's baton message."""
    current = get_handoff_session(signal)
    depth = int((current or {}).get("depth") or 1) + 1
    if depth > MAX_HANDOFF_DEPTH:
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="handoff_depth_exceeded",
                actor_type="agent",
                actor_id=str(from_agent_id),
                payload_json=json.dumps({"depth": depth, "max": MAX_HANDOFF_DEPTH}),
            )
        )
        await session.flush()
        return {"ok": False, "error": "handoff_depth_exceeded", "depth": depth}

    # Mark parent done before nesting.
    if current:
        current = {**current, "status": "handed_off"}
        _write_handoff(signal, current)
        session.add(signal)
        await session.flush()

    # Opener already persisted; attribute the baton to the agent (not as a
    # fake user_id — that broke usage_ledger FK and killed nested turns).
    started = await start_handoff_session(
        session,
        tenant_id,
        signal,
        body_text=body_text,
        author_user_id=None,
        author_name="",
        user_role=user_role,
        depth=depth,
        parent_id=(current or {}).get("id"),
        channel_agent_id=signal.agent_id,
        requested_by_kind="agent",
        requested_by_id=from_agent_id,
        defer_peer=False,
        original_request=str((current or {}).get("prompt") or ""),
    )
    if started is None:
        return {"ok": False, "error": "no_session"}
    return started


def complete_handoff_session(
    signal: Signal,
    *,
    reason: str = "peer_finished",
) -> dict[str, Any] | None:
    """Mark the open handoff done so a wake-back report cannot re-nest."""
    current = get_handoff_session(signal)
    if not current or current.get("status") not in ("open", "handed_off"):
        return None
    updated = {
        **current,
        "status": "done",
        "completed_at": datetime.utcnow().isoformat(),
        "complete_reason": reason,
    }
    _write_handoff(signal, updated)
    return updated


async def interrupt_handoff_session(
    session: AsyncSession,
    signal: Signal,
    *,
    by_message_id: UUID | str | None = None,
    reason: str = "user_send",
) -> dict[str, Any] | None:
    """Cancel an open handoff tree on Send / inbound. Draft typing does not call this."""
    current = get_handoff_session(signal)
    if not current or current.get("status") not in ("open", "handed_off"):
        return None
    updated = {
        **current,
        "status": "interrupted",
        "interrupted_at": datetime.utcnow().isoformat(),
        "interrupted_by_message_id": str(by_message_id) if by_message_id else None,
        "interrupt_reason": reason,
    }
    _write_handoff(signal, updated)
    session.add(signal)
    # Clear open floor so delayed peer jobs exit as stale_nonce.
    from app.services.participant_turns import clear_active_turn

    clear_active_turn(signal, reset_streak=True)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="handoff_session_interrupted",
            actor_type="system",
            actor_id="",
            payload_json=json.dumps(updated),
        )
    )
    await session.flush()
    return updated


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
        return True
    except ValueError:
        return False
