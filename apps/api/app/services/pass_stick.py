"""What a saved message means for the next turn.

A person's message queues turns for the agents it names (in order, one per
agent; "allebei" names them all), or for the agent ``team_router`` picks when
it names nobody. An agent's message never queues a turn here: agents ask with
``ask_agent``, a bubble that starts with ``@agent``, or ``handoff_to``.
Mentioned people get a ping either way.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.signal import Signal, SignalMessage
from app.models.signal_participant import SignalParticipant
from app.services.participant_turns import _parse_active
from app.services.addressing import _PLURAL
from app.services.thread_dispatch import plain_mentions

logger = logging.getLogger(__name__)

_USER_MENTION = re.compile(
    r"@\[([^\]]+)\]\(user:([^)]+)\)",
    re.IGNORECASE,
)
_VIEW_TTL_S = 180


def _stick_copy(lang: str, key: str, *, name: str = "") -> str:
    nl = (lang or "").lower().startswith("nl")
    if key == "back":
        return "De beurt ligt weer bij jullie." if nl else "The turn is back with you."
    if key == "not_addressed":
        return f"{name} is niet aangesproken." if nl else f"{name} was not addressed."
    if key == "mentioned":
        who = name or ("Iemand" if nl else "Someone")
        return f"{who} noemde je" if nl else f"{who} mentioned you"
    if key == "customer":
        return "Nieuw bericht van een klant" if nl else "New customer message"
    return key


def _plural(text: str) -> bool:
    return bool(_PLURAL.search(text or ""))


def _user_mentions(body_text: str) -> list[UUID]:
    found: list[UUID] = []
    for _name, raw in _USER_MENTION.findall(body_text or ""):
        try:
            ref = UUID(str(raw).strip())
        except ValueError:
            continue
        if ref not in found:
            found.append(ref)
    return found


def decide_stick(
    *,
    author_kind: str,
    mentioned_agent_ids: list[UUID],
    mentioned_human_ids: list[UUID],
    text: str,
    holder_id: UUID | None,
    wake_default: bool,
    channel_agent_id: UUID | None,
) -> dict[str, Any]:
    """Which agents a message queues, in order. ``give`` names them in ``agent_ids``."""
    agents = list(mentioned_agent_ids)
    humans = list(mentioned_human_ids)

    if author_kind == "agent":
        return {"action": "none", "reason": "agent_message", "notify_user_ids": humans}

    if author_kind == "customer":
        if channel_agent_id is None:
            return {"action": "none", "reason": "no_channel_agent", "notify_user_ids": []}
        return {
            "action": "give",
            "agent_ids": [channel_agent_id],
            "notify_user_ids": [],
            "reason": "customer",
        }

    if humans and not agents:
        return {"action": "clear", "reason": "human_only", "notify_user_ids": humans}
    if len(agents) >= 2 and _plural(text):
        return {"action": "give", "agent_ids": agents, "notify_user_ids": humans, "reason": "plural"}
    if agents:
        return {"action": "give", "agent_ids": agents[:1], "notify_user_ids": humans, "reason": "mention"}
    if holder_id is not None:
        return {"action": "give", "agent_ids": [holder_id], "notify_user_ids": [], "reason": "follow_up"}
    if wake_default and channel_agent_id is not None:
        return {
            "action": "give",
            "agent_ids": [channel_agent_id],
            "notify_user_ids": [],
            "reason": "follow_up",
        }
    return {"action": "none", "reason": "idle", "notify_user_ids": humans}


def _holder(signal: Signal) -> UUID | None:
    active = _parse_active(signal)
    raw = str(active.get("ref_id") or "").strip()
    if not raw or not active.get("nonce"):
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


async def _expand_teams(
    session: AsyncSession,
    tenant_id: UUID,
    body_text: str,
) -> tuple[list[UUID], list[UUID]]:
    """Addressed agent ids in mention order, plus people pulled in by an @team.

    A mention inside a sentence only names an agent (``services/addressing``);
    it pings team members but queues no turn.
    """
    from app.models.team import is_root_department
    from app.services.addressing import resolve
    from app.services.lead_agent import get_lead_agent
    from app.services.teams import get_team, team_agent_ids, team_user_ids

    agents: list[UUID] = []
    humans: list[UUID] = _user_mentions(body_text)
    for mention in resolve(body_text).mentions:
        target_id = mention.id
        if mention.kind == "agent":
            if mention.addressed and target_id not in agents:
                agents.append(target_id)
            continue
        team = await get_team(session, tenant_id, target_id)
        if team is None:
            continue
        for uid in await team_user_ids(session, team):
            if uid not in humans:
                humans.append(uid)
        if not mention.addressed:
            continue
        picked: UUID | None = None
        if is_root_department(team):
            lead = await get_lead_agent(session, tenant_id)
            if lead is not None and lead.is_active:
                picked = lead.id
        elif team.pickup == "agent_first":
            for aid in await team_agent_ids(session, team):
                agent = await session.get(Agent, aid)
                if agent is not None and agent.tenant_id == tenant_id and agent.is_active:
                    picked = agent.id
                    break
        if picked is not None and picked not in agents:
            agents.append(picked)
    return agents, humans


async def _ensure_members(
    session: AsyncSession,
    signal: Signal,
    *,
    agent_ids: list[UUID],
    human_ids: list[UUID],
    author_kind: str,
    author_id: UUID | None,
) -> None:
    from app.services.participants import ensure_participant

    for agent_id in agent_ids:
        agent = await session.get(Agent, agent_id)
        if agent is None or agent.tenant_id != signal.tenant_id or not agent.is_active:
            continue
        await ensure_participant(
            session,
            signal,
            kind="agent",
            ref_id=agent_id,
            role="member",
            invited_by_kind=author_kind if author_kind in ("user", "agent") else "system",
            invited_by_id=author_id,
            joined_via="mention",
        )
    for user_id in human_ids:
        await ensure_participant(
            session,
            signal,
            kind="user",
            ref_id=user_id,
            role="member",
            invited_by_kind=author_kind if author_kind in ("user", "agent") else "system",
            invited_by_id=author_id,
            joined_via="mention",
        )


async def _system_line(session: AsyncSession, signal: Signal, text: str) -> None:
    from app.gateway.publish import publish_signal_message

    now = datetime.utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind="system_event",
        direction="internal",
        role="system",
        body_text=text,
        body_preview=text[:200],
        metadata_json=json.dumps({"stick": True}),
        send_status="skipped",
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    session.add(signal)
    await session.flush()
    try:
        await publish_signal_message(signal, message)
    except Exception:  # noqa: BLE001
        logger.debug("publish stick line failed", exc_info=True)


async def thread_viewer_ids(signal_id: UUID) -> set[str]:
    """User ids with this thread open, on this process and via Redis."""
    from app.gateway.manager import manager

    local = {
        connection.user_id
        for connection in manager.connections
        if connection.kind == "user"
        and connection.user_id
        and f"signal:{signal_id}" in connection.topics
    }
    remote: set[str] = set()
    try:
        from redis.asyncio import Redis

        from app.config import get_settings

        redis = Redis.from_url(get_settings().redis_url)
        try:
            members = await redis.smembers(f"bokito:thread-viewers:{signal_id}")
            remote = {item.decode() if isinstance(item, bytes) else str(item) for item in members}
        finally:
            await redis.aclose()
    except Exception:  # noqa: BLE001
        logger.debug("thread viewer redis read failed", exc_info=True)
    return local | remote


async def remember_thread_viewer(signal_id: str, user_id: str) -> None:
    try:
        from redis.asyncio import Redis

        from app.config import get_settings

        redis = Redis.from_url(get_settings().redis_url)
        try:
            key = f"bokito:thread-viewers:{signal_id}"
            await redis.sadd(key, user_id)
            await redis.expire(key, _VIEW_TTL_S)
        finally:
            await redis.aclose()
    except Exception:  # noqa: BLE001
        logger.debug("remember thread viewer failed", exc_info=True)


async def forget_thread_viewer(signal_id: str, user_id: str) -> None:
    try:
        from redis.asyncio import Redis

        from app.config import get_settings

        redis = Redis.from_url(get_settings().redis_url)
        try:
            await redis.srem(f"bokito:thread-viewers:{signal_id}", user_id)
        finally:
            await redis.aclose()
    except Exception:  # noqa: BLE001
        logger.debug("forget thread viewer failed", exc_info=True)


async def bump_member_unread(
    session: AsyncSession,
    signal: Signal,
    *,
    author_user_id: UUID | None = None,
) -> list[UUID]:
    """Count the message for human members who are not looking. Returns them."""
    viewers = await thread_viewer_ids(signal.id)
    rows = (
        await session.execute(
            select(SignalParticipant).where(
                SignalParticipant.tenant_id == signal.tenant_id,
                SignalParticipant.signal_id == signal.id,
                SignalParticipant.kind == "user",
                SignalParticipant.left_at.is_(None),
            )
        )
    ).scalars().all()
    bumped: list[UUID] = []
    for row in rows:
        if author_user_id is not None and row.ref_id == author_user_id:
            continue
        if str(row.ref_id) in viewers:
            continue
        row.unread_count = int(row.unread_count or 0) + 1
        session.add(row)
        bumped.append(row.ref_id)
    if bumped:
        signal.has_unread = True
        session.add(signal)
        await session.flush()
    return bumped


async def mark_member_read(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    user_id: UUID,
) -> None:
    row = (
        await session.execute(
            select(SignalParticipant).where(
                SignalParticipant.tenant_id == tenant_id,
                SignalParticipant.signal_id == signal_id,
                SignalParticipant.kind == "user",
                SignalParticipant.ref_id == user_id,
                SignalParticipant.left_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if row is None or int(row.unread_count or 0) == 0:
        return
    row.unread_count = 0
    session.add(row)
    await session.flush()


async def viewer_unread_ids(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_ids: list[UUID],
) -> set[UUID]:
    if not signal_ids:
        return set()
    rows = (
        await session.execute(
            select(SignalParticipant.signal_id).where(
                SignalParticipant.tenant_id == tenant_id,
                SignalParticipant.kind == "user",
                SignalParticipant.ref_id == user_id,
                SignalParticipant.left_at.is_(None),
                SignalParticipant.unread_count > 0,
                SignalParticipant.signal_id.in_(signal_ids),
            )
        )
    ).scalars().all()
    return set(rows)


async def _ping(
    session: AsyncSession,
    signal: Signal,
    user_ids: list[UUID],
    *,
    title: str,
    body: str,
    author_user_id: UUID | None,
) -> None:
    if not user_ids:
        return
    viewers = await thread_viewer_ids(signal.id)
    recipients = [
        user_id
        for user_id in user_ids
        if user_id != author_user_id and str(user_id) not in viewers
    ]
    if not recipients:
        return
    from app.services.notify import TIER_NOW, notify

    await notify(
        session,
        signal.tenant_id,
        kind="mention",
        recipients=recipients,
        title=title[:200],
        body=plain_mentions(body)[:300],
        tier=TIER_NOW,
        category="mentions",
        signal_id=signal.id,
        exclude=author_user_id,
    )


async def pass_stick(
    session: AsyncSession,
    signal: Signal,
    *,
    body_text: str,
    author_kind: str,
    author_id: UUID | None = None,
    author_name: str = "",
    wake_default: bool = False,
    channel_agent_id: UUID | None = None,
    enqueue: bool = True,
    message_id: UUID | None = None,
) -> dict[str, Any]:
    """Queue the turns a saved message asks for and ping mentioned people."""
    from app.models.auth import Tenant
    from app.services.agent_turns import cancel_turns, enqueue_turn, latest_human_message_id
    from app.models.signal import is_internal_channel
    from app.services.language import resolve_workspace_language

    tenant = await session.get(Tenant, signal.tenant_id)
    lang = resolve_workspace_language(tenant)

    agents, humans = await _expand_teams(session, signal.tenant_id, body_text)
    if author_kind == "agent" and author_id is not None:
        agents = [agent_id for agent_id in agents if agent_id != author_id]
    await _ensure_members(
        session,
        signal,
        agent_ids=agents,
        human_ids=humans,
        author_kind=author_kind,
        author_id=author_id,
    )
    holder = _holder(signal)
    if (
        holder is None
        and author_kind == "user"
        and not agents
        and not humans
        and is_internal_channel(signal.channel)
    ):
        from app.services.team_router import pick_responder

        holder = (await pick_responder(session, signal, body_text)).agent_id
    choice = decide_stick(
        author_kind=author_kind,
        mentioned_agent_ids=agents,
        mentioned_human_ids=humans,
        text=body_text,
        holder_id=holder,
        wake_default=wake_default,
        channel_agent_id=channel_agent_id or signal.agent_id,
    )
    await bump_member_unread(
        session,
        signal,
        author_user_id=author_id if author_kind == "user" else None,
    )

    notify_ids = list(choice.get("notify_user_ids") or [])
    if notify_ids:
        await _ping(
            session,
            signal,
            notify_ids,
            title=_stick_copy(lang, "mentioned", name=author_name),
            body=body_text,
            author_user_id=author_id if author_kind == "user" else None,
        )

    if author_kind == "agent":
        return {**choice, "ok": True, "holder_id": None}

    episode = message_id or await latest_human_message_id(session, signal.id)
    if author_kind in ("user", "customer"):
        await cancel_turns(session, signal, keep_episode=episode, outcome="superseded")

    action = choice.get("action")
    if action == "clear" and choice.get("reason") == "human_only" and holder is not None:
        agent = await session.get(Agent, holder)
        if agent is not None and agent.name:
            await _system_line(session, signal, _stick_copy(lang, "not_addressed", name=agent.name))
    if action != "give" or not enqueue:
        return {**choice, "ok": True, "holder_id": None}

    turns: list[dict[str, Any]] = []
    for agent_id in choice.get("agent_ids") or []:
        key = f"msg:{message_id}:{agent_id}" if message_id else None
        turn = await enqueue_turn(
            session,
            signal,
            agent_id=agent_id,
            cause_kind="human" if author_kind in ("user", "customer") else "system",
            requested_by_kind=author_kind if author_kind in ("user", "customer") else "system",
            requested_by_id=author_id if author_kind == "user" else None,
            prompt=plain_mentions(body_text)[:2000],
            cause_message_id=message_id,
            episode_id=episode,
            idempotency_key=key,
        )
        turns.append(turn)
    first = next((t for t in turns if t.get("ok")), None)
    if first is None:
        reason = turns[0].get("error") if turns else "give_failed"
        return {**choice, "ok": False, "action": "clear", "reason": reason or "give_failed"}
    return {
        **choice,
        "ok": True,
        "action": "give",
        "holder_id": str(first.get("agent_id") or ""),
        "turn": first,
        "turns": turns,
    }


async def hold_customer_stick(session: AsyncSession, signal: Signal, agent: Agent) -> None:
    """Show the channel agent as the holder while inbound handling runs."""
    from app.models.auth import Tenant
    from app.services.language import resolve_workspace_language
    from app.services.participant_turns import request_participant_turn

    active = _parse_active(signal)
    if active.get("nonce") and active.get("ref_id") == str(agent.id):
        return
    await request_participant_turn(
        session,
        signal,
        member_kind="agent",
        member_ref_id=agent.id,
        prompt="",
        requested_by_kind="system",
        requested_by_id=None,
        run=False,
        enqueue=False,
    )
    await bump_member_unread(session, signal)
    rows = (
        await session.execute(
            select(SignalParticipant.ref_id).where(
                SignalParticipant.tenant_id == signal.tenant_id,
                SignalParticipant.signal_id == signal.id,
                SignalParticipant.kind == "user",
                SignalParticipant.left_at.is_(None),
            )
        )
    ).scalars().all()
    assignee = getattr(signal, "assigned_user_id", None)
    extra = [ref for ref in rows if ref != assignee]
    if extra:
        await _ping(
            session,
            signal,
            extra,
            title=_stick_copy(
                resolve_workspace_language(await session.get(Tenant, signal.tenant_id)),
                "customer",
            ),
            body=(signal.subject or "")[:300],
            author_user_id=None,
        )

