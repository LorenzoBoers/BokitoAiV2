"""Who speaks next in a conversation. The database decides.

A turn is a row in ``agent_turns``. People and agents queue turns; the worker
claims the oldest queued row with ``FOR UPDATE SKIP LOCKED``, at most one row
per conversation runs (partial unique index), and every enqueue carries an
idempotency key so a retry never doubles a turn. Redis only rings the bell.
A sweep every ten seconds re-rings lost bells and re-queues expired leases.

Agents move the conversation with ``ask_agent`` (a question; the answer comes
back to the asker as its next turn) and ``handoff_to`` (the other agent takes
over). An ``@agent`` mention in an agent's text is only a link; it wakes
nobody.

An episode is everything agents do after one human message. It ends when no
turn is queued, or when the budget below runs out; then a system line hands
the conversation back.

``signals.floor_json`` is a read model written from these rows so the header
and composer can show who is speaking.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.core.time import utcnow
from app.models.agent import Agent, AgentRun
from app.models.agent_turn import AgentAsk, AgentTurn
from app.models.signal import Signal, SignalMessage

logger = logging.getLogger(__name__)

# Agent turns after one human message.
MAX_EPISODE_TURNS = 6
# Times one agent may ask or hand to the same agent in one episode.
MAX_PAIR_REPEATS = 2
# Input + output tokens all agent turns of one episode may spend.
EPISODE_TOKEN_BUDGET = 400_000
LEASE_S = 300
INLINE_LEASE_S = 600
MAX_ATTEMPTS = 2
# A queued turn this old is dropped by the sweep.
QUEUED_MAX_AGE_S = 900
# A queued turn this old without a running neighbour gets its bell again.
REBELL_AFTER_S = 20
_MAX_DRAIN = 12

# Turns this process runs right now: "queue" (drain) or "inline". A shutdown hands them back.
_HELD: dict[UUID, str] = {}

_BELLS = "agent_turn_bells"
_HOOKED = "agent_turn_hooked"


# -- episode and budget -----------------------------------------------------


async def latest_human_message_id(session: AsyncSession, signal_id: UUID) -> UUID | None:
    return (
        await session.execute(
            select(SignalMessage.id)
            .where(
                SignalMessage.signal_id == signal_id,
                SignalMessage.role == "user",
                SignalMessage.author_agent_id.is_(None),
                SignalMessage.kind.notin_(("system_event", "internal_note")),
            )
            .order_by(SignalMessage.seq.desc(), SignalMessage.id.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _requester_episode(
    session: AsyncSession, signal_id: UUID, agent_id: UUID | None
) -> UUID | None:
    if agent_id is None:
        return None
    return (
        await session.execute(
            select(AgentTurn.episode_id)
            .where(
                AgentTurn.signal_id == signal_id,
                AgentTurn.agent_id == agent_id,
                AgentTurn.status.in_(("running", "done")),
            )
            .order_by(AgentTurn.status.desc(), AgentTurn.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def episode_spend(session: AsyncSession, signal_id: UUID, episode_id: UUID) -> dict[str, int]:
    row = (
        await session.execute(
            select(func.count(AgentTurn.id), func.coalesce(func.sum(AgentTurn.tokens), 0)).where(
                AgentTurn.signal_id == signal_id,
                AgentTurn.episode_id == episode_id,
                AgentTurn.status != "cancelled",
            )
        )
    ).one()
    return {"turns": int(row[0] or 0), "tokens": int(row[1] or 0)}


async def budget_refusal(
    session: AsyncSession,
    signal_id: UUID,
    episode_id: UUID | None,
    *,
    from_agent_id: UUID | None,
    to_agent_id: UUID,
) -> str | None:
    """Why an agent may not start one more turn in this episode, or None."""
    if episode_id is None:
        return None
    spend = await episode_spend(session, signal_id, episode_id)
    if spend["turns"] >= MAX_EPISODE_TURNS:
        return "turns"
    if spend["tokens"] >= EPISODE_TOKEN_BUDGET:
        return "tokens"
    if from_agent_id is not None:
        repeats = (
            await session.execute(
                select(func.count(AgentTurn.id)).where(
                    AgentTurn.signal_id == signal_id,
                    AgentTurn.episode_id == episode_id,
                    AgentTurn.requested_by_id == from_agent_id,
                    AgentTurn.agent_id == to_agent_id,
                    AgentTurn.cause_kind.in_(("ask", "handoff")),
                    AgentTurn.status != "cancelled",
                )
            )
        ).scalar_one()
        if int(repeats or 0) >= MAX_PAIR_REPEATS:
            return "repeat"
    return None


def _stop_copy(lang: str) -> str:
    if (lang or "").lower().startswith("nl"):
        return "Ik stop hier, jij bent aan zet."
    return "I stop here, it is your turn."


async def post_episode_stop(session: AsyncSession, signal: Signal, episode_id: UUID | None) -> None:
    """One system line per episode when agents hand the conversation back."""
    from app.gateway.publish import publish_signal_message
    from app.models.auth import Tenant
    from app.services.language import resolve_workspace_language

    marker = str(episode_id or "none")
    seen = (
        await session.execute(
            select(SignalMessage.id).where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind == "system_event",
                SignalMessage.metadata_json.contains(f'"episode_stop": "{marker}"'),
            )
        )
    ).first()
    if seen is not None:
        return
    lang = resolve_workspace_language(await session.get(Tenant, signal.tenant_id))
    line = _stop_copy(lang)
    now = utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=signal.tenant_id,
        kind="system_event",
        direction="internal",
        role="system",
        body_text=line,
        body_preview=line,
        metadata_json=json.dumps({"stick": True, "episode_stop": marker}),
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
        logger.debug("publish episode stop failed", exc_info=True)


# -- floor read model ---------------------------------------------------------


async def sync_floor(session: AsyncSession, signal: Signal, *, publish: bool = True) -> dict[str, Any]:
    """Write ``active_turn`` from the rows: the running turn, else the next queued one."""
    from app.services.participant_turns import _parse_active

    row = (
        await session.execute(
            select(AgentTurn)
            .where(AgentTurn.signal_id == signal.id, AgentTurn.status.in_(("running", "queued")))
            .order_by(AgentTurn.status.desc(), AgentTurn.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()
    current = _parse_active(signal)
    floor: dict[str, Any] = {}
    if row is not None:
        agent = await session.get(Agent, row.agent_id)
        floor = {
            "kind": "agent",
            "ref_id": str(row.agent_id),
            "name": agent.name if agent else "",
            "nonce": str(row.id),
            "turn_id": str(row.id),
            "status": row.status,
            "requested_by_kind": row.requested_by_kind,
            "requested_by_id": str(row.requested_by_id) if row.requested_by_id else None,
        }
        if row.status == "running" and row.started_at:
            floor["claimed_at"] = row.started_at.isoformat()
    elif current.get("turn_id") or not current.get("nonce"):
        floor = {}
    else:
        # A presence chip set without a turn row (inbound handling) stays.
        return current
    if floor == current:
        return floor
    signal.active_turn_json = json.dumps(floor)
    session.add(signal)
    await session.flush()
    if publish:
        try:
            from app.gateway.publish import publish_thread_presence, publish_thread_update

            await publish_thread_presence(
                signal.tenant_id,
                signal.id,
                phase="thinking" if floor else "idle",
                actor_kind="agent",
                actor_id=floor.get("ref_id") or current.get("ref_id"),
                actor_name=str(floor.get("name") or current.get("name") or ""),
                item={"active_turn": floor or None},
            )
            await publish_thread_update(signal)
        except Exception:  # noqa: BLE001
            logger.debug("publish floor failed", exc_info=True)
    return floor


# -- doorbell ------------------------------------------------------------------


def ring_after_commit(session: AsyncSession, signal_id: UUID) -> None:
    """Ring the bell for ``signal_id`` once this session commits."""
    from sqlalchemy import event

    bells: set[UUID] = session.info.setdefault(_BELLS, set())
    bells.add(signal_id)
    if session.info.get(_HOOKED):
        return
    session.info[_HOOKED] = True
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    def _after_commit(_sync_session) -> None:
        pending = list(session.info.pop(_BELLS, set()) or [])
        for sid in pending:
            loop.call_soon_threadsafe(lambda sid=sid: asyncio.ensure_future(ring(sid)))

    event.listen(session.sync_session, "after_commit", _after_commit)


async def ring(signal_id: UUID) -> None:
    """Wake the worker for this conversation; drain in-process when Redis is down."""
    try:
        from app.workers.tasks import _get_arq_pool

        redis = await _get_arq_pool()
        await redis.enqueue_job("run_agent_turns_job", str(signal_id))
        return
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis unavailable, agent turns for %s run in-process: %s", signal_id, exc)
    asyncio.ensure_future(drain(signal_id))


# -- enqueue ---------------------------------------------------------------------


async def enqueue_turn(
    session: AsyncSession,
    signal: Signal,
    *,
    agent_id: UUID,
    cause_kind: str,
    requested_by_kind: str,
    requested_by_id: UUID | None = None,
    prompt: str = "",
    cause_message_id: UUID | None = None,
    ask_id: UUID | None = None,
    episode_id: UUID | None = None,
    idempotency_key: str | None = None,
    ring_bell: bool = True,
) -> dict[str, Any]:
    """Queue a turn. Safe to call twice with the same key. Caller commits."""
    from app.services.participants import ensure_participant

    agent = await session.get(Agent, agent_id)
    if agent is None or agent.tenant_id != signal.tenant_id:
        return {"ok": False, "error": "Agent not found"}
    if not agent.is_active or agent.kind == "archived":
        return {"ok": False, "error": "Agent is not active"}

    if episode_id is None:
        if requested_by_kind == "agent":
            episode_id = await _requester_episode(session, signal.id, requested_by_id)
        if episode_id is None:
            episode_id = cause_message_id or await latest_human_message_id(session, signal.id)

    if requested_by_kind == "agent":
        refused = await budget_refusal(
            session,
            signal.id,
            episode_id,
            from_agent_id=requested_by_id,
            to_agent_id=agent_id,
        )
        if refused:
            await post_episode_stop(session, signal, episode_id)
            return {
                "ok": False,
                "outcome": "budget",
                "error": f"episode_budget_{refused}",
                "agent_id": str(agent_id),
                "agent_name": agent.name,
            }

    await ensure_participant(
        session,
        signal,
        kind="agent",
        ref_id=agent_id,
        role="member",
        invited_by_kind=requested_by_kind if requested_by_kind in ("user", "agent") else "system",
        invited_by_id=requested_by_id,
        joined_via="turn",
    )

    key = idempotency_key or f"{cause_kind}:{cause_message_id or ask_id or uuid.uuid4()}:{agent_id}"
    row = AgentTurn(
        tenant_id=signal.tenant_id,
        signal_id=signal.id,
        agent_id=agent_id,
        cause_kind=cause_kind,
        cause_message_id=cause_message_id,
        requested_by_kind=requested_by_kind,
        requested_by_id=requested_by_id,
        prompt=(prompt or "").strip()[:4000],
        ask_id=ask_id,
        episode_id=episode_id,
        idempotency_key=key[:200],
    )
    outcome = "queued"
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()
    except IntegrityError:
        existing = (
            await session.execute(select(AgentTurn).where(AgentTurn.idempotency_key == key[:200]))
        ).scalar_one_or_none()
        if existing is None:
            raise
        row = existing
        outcome = "duplicate"
    floor = await sync_floor(session, signal)
    if ring_bell and outcome == "queued":
        ring_after_commit(session, signal.id)
    return {
        "ok": True,
        "outcome": outcome,
        "turn_id": str(row.id),
        "agent_id": str(agent_id),
        "agent_name": agent.name,
        "active_turn": floor or None,
    }


async def create_ask(
    session: AsyncSession,
    signal: Signal,
    *,
    from_agent: Agent,
    peer: Agent,
    question: str,
) -> dict[str, Any]:
    """Open a question to ``peer`` and queue its turn. One open ask per pair."""
    question = (question or "").strip()
    if not question:
        return {"ok": False, "error": "question required"}
    open_ask = (
        await session.execute(
            select(AgentAsk.id).where(
                AgentAsk.signal_id == signal.id,
                AgentAsk.from_agent_id == from_agent.id,
                AgentAsk.to_agent_id == peer.id,
                AgentAsk.status == "open",
            )
        )
    ).scalar_one_or_none()
    if open_ask is not None:
        return {"ok": True, "ask_id": str(open_ask), "already_asked": True}
    episode = await _requester_episode(session, signal.id, from_agent.id) or await latest_human_message_id(
        session, signal.id
    )
    ask = AgentAsk(
        tenant_id=signal.tenant_id,
        signal_id=signal.id,
        from_agent_id=from_agent.id,
        to_agent_id=peer.id,
        question=question[:4000],
        episode_id=episode,
    )
    session.add(ask)
    await session.flush()
    queued = await enqueue_turn(
        session,
        signal,
        agent_id=peer.id,
        cause_kind="ask",
        requested_by_kind="agent",
        requested_by_id=from_agent.id,
        prompt=question,
        ask_id=ask.id,
        episode_id=episode,
        idempotency_key=f"ask:{ask.id}",
    )
    if not queued.get("ok"):
        ask.status = "cancelled"
        session.add(ask)
        await session.flush()
        return {"ok": False, "error": queued.get("error") or "Could not ask"}
    return {"ok": True, "ask_id": str(ask.id), "already_asked": False}


async def cancel_turns(
    session: AsyncSession,
    signal: Signal,
    *,
    statuses: tuple[str, ...] = ("queued",),
    keep_episode: UUID | None = None,
    outcome: str = "cancelled",
) -> list[AgentTurn]:
    """Cancel open turns, except those of ``keep_episode``. Caller commits."""
    q = select(AgentTurn).where(AgentTurn.signal_id == signal.id, AgentTurn.status.in_(statuses))
    rows = list((await session.execute(q)).scalars().all())
    now = utcnow()
    hit: list[AgentTurn] = []
    for row in rows:
        if keep_episode is not None and row.episode_id == keep_episode:
            continue
        row.status = "cancelled"
        row.outcome = outcome
        row.finished_at = now
        row.lease_until = None
        session.add(row)
        hit.append(row)
    if hit:
        await session.flush()
        open_asks = [row.ask_id for row in hit if row.ask_id]
        if open_asks:
            await session.execute(
                update(AgentAsk)
                .where(AgentAsk.id.in_(open_asks), AgentAsk.status == "open")
                .values(status="cancelled")
            )
        await sync_floor(session, signal)
    return hit


async def stop_conversation(session: AsyncSession, signal: Signal) -> list[UUID]:
    """Stop button: cancel queued and running turns; return the runs to cancel."""
    rows = await cancel_turns(session, signal, statuses=("queued", "running"), outcome="stopped")
    return [row.run_id for row in rows if row.run_id]


# -- claim and run -----------------------------------------------------------------


async def claim_next(session: AsyncSession, signal_id: UUID) -> AgentTurn | None:
    running = (
        await session.execute(
            select(AgentTurn.id).where(AgentTurn.signal_id == signal_id, AgentTurn.status == "running")
        )
    ).first()
    if running is not None:
        return None
    row = (
        await session.execute(
            select(AgentTurn)
            .where(AgentTurn.signal_id == signal_id, AgentTurn.status == "queued")
            .order_by(AgentTurn.created_at.asc())
            .limit(1)
            .with_for_update(skip_locked=True)
        )
    ).scalar_one_or_none()
    if row is None:
        await session.rollback()
        return None
    now = utcnow()
    row.status = "running"
    row.started_at = now
    row.lease_until = now + timedelta(seconds=LEASE_S)
    row.attempt = int(row.attempt or 0) + 1
    session.add(row)
    try:
        await session.flush()
        signal = await session.get(Signal, signal_id)
        if signal is not None:
            await sync_floor(session, signal)
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return None
    return row


async def drain(signal_id: UUID) -> int:
    """Run queued turns of one conversation, one at a time, until none is left."""
    from app.db.session import async_session_factory

    done = 0
    for _ in range(_MAX_DRAIN):
        async with async_session_factory() as session:
            turn = await claim_next(session, signal_id)
            if turn is None:
                return done
            turn_id = turn.id
            _HELD[turn_id] = "queue"
            try:
                await execute_turn(session, turn)
            except Exception:  # noqa: BLE001
                logger.exception("agent turn %s crashed", turn_id)
                await session.rollback()
                await _fail_turn(session, turn_id, "error")
            _HELD.pop(turn_id, None)
            done += 1
    return done


async def _fail_turn(session: AsyncSession, turn_id: UUID, outcome: str) -> None:
    row = await session.get(AgentTurn, turn_id)
    if row is None or row.status not in ("running", "queued"):
        return
    row.status = "failed"
    row.outcome = outcome
    row.finished_at = utcnow()
    row.lease_until = None
    session.add(row)
    signal = await session.get(Signal, row.signal_id)
    if signal is not None:
        await sync_floor(session, signal)
    await session.commit()


def _name(agent: Agent | None) -> str:
    return (agent.name if agent else "") or "An agent"


async def _requester_name(session: AsyncSession, turn: AgentTurn) -> str:
    if turn.requested_by_id is None:
        return "Someone"
    if turn.requested_by_kind == "agent":
        return _name(await session.get(Agent, turn.requested_by_id))
    from app.models.auth import User

    user = await session.get(User, turn.requested_by_id)
    if user is None:
        return "A colleague"
    return user.display_name or (user.email or "").split("@")[0] or "A colleague"


async def _open_asks_block(session: AsyncSession, signal_id: UUID, agent_id: UUID) -> str:
    rows = (
        await session.execute(
            select(AgentAsk)
            .where(
                AgentAsk.signal_id == signal_id,
                AgentAsk.status == "open",
                (AgentAsk.from_agent_id == agent_id) | (AgentAsk.to_agent_id == agent_id),
            )
            .order_by(AgentAsk.created_at.asc())
            .limit(6)
        )
    ).scalars().all()
    if not rows:
        return ""
    lines = ["## Open questions in this conversation"]
    for ask in rows:
        if ask.from_agent_id == agent_id:
            peer = _name(await session.get(Agent, ask.to_agent_id))
            lines.append(f'- You asked {peer}: "{ask.question[:300]}" (waiting for the answer)')
        else:
            peer = _name(await session.get(Agent, ask.from_agent_id))
            lines.append(f'- {peer} asked you: "{ask.question[:300]}"')
    return "\n".join(lines)


async def _turn_brief(session: AsyncSession, turn: AgentTurn, agent: Agent) -> tuple[str, list[dict]]:
    """Why it is this agent's turn, and images that belong to it."""
    who = await _requester_name(session, turn)
    attachments: list[dict] = []
    if turn.cause_kind == "ask" and turn.ask_id:
        ask = await session.get(AgentAsk, turn.ask_id)
        question = ask.question if ask else turn.prompt
        text_ = (
            f'{who} asked you in this conversation: "{question[:1500]}"\n'
            f"Answer in this conversation in your own voice. {who} gets your answer, "
            "with any picture you make, and continues with the human. "
            "Do not mention or ask them back unless you need something."
        )
    elif turn.cause_kind == "answer" and turn.ask_id:
        ask = await session.get(AgentAsk, turn.ask_id)
        peer = _name(await session.get(Agent, ask.to_agent_id)) if ask else "The other agent"
        parts: list[dict] = []
        if ask is not None:
            try:
                parts = json.loads(ask.answer_json or "[]")
            except json.JSONDecodeError:
                parts = []
        images = [p for p in parts if isinstance(p, dict) and p.get("type") == "image" and p.get("url")]
        attachments = [{"url": p["url"], "mime": p.get("mime") or "image/png", "name": "answer"} for p in images[:4]]
        if ask is not None and ask.status == "answered" and (ask.answer_text or images):
            seen = " The picture they made is attached; you can see it." if images else ""
            text_ = (
                f'You asked {peer}: "{(ask.question if ask else "")[:600]}". '
                f"Their answer is in the conversation above.{seen}\n"
                "Continue the work for the human who asked you. Use the answer; "
                "do not repeat it word for word. Say only what adds something."
            )
        else:
            text_ = (
                f"You asked {peer} something, but no answer came. "
                "Tell the human in one short sentence and continue without it."
            )
    elif turn.cause_kind == "handoff":
        text_ = (
            f"{who} handed this conversation to you with this brief: \"{turn.prompt[:1500]}\"\n"
            "You now answer the human. Take it from here."
        )
    elif turn.cause_kind in ("human", "mention"):
        text_ = f"{who} wrote in this conversation and it is your turn. Reply to what they asked."
        cause = await session.get(SignalMessage, turn.cause_message_id) if turn.cause_message_id else None
        if cause is not None:
            from app.services.addressing import turn_line

            line = turn_line(cause.body_text or "", agent.id)
            if line:
                text_ += "\n" + line
    else:
        text_ = turn.prompt or "It is your turn in this conversation."
    return text_, attachments


def close_on_brief(history: list[dict[str, Any]], brief: str) -> tuple[list[dict[str, Any]], str]:
    """A model answers a conversation that ends on the human side.

    A wake with no new human line (an answered card, an ask, a handoff) closes
    on its brief instead; the providers reject a request that ends on the
    agent's own message. Returns the history and the brief still to pass as
    context ("" when it became the closing line).
    """
    if history and history[-1].get("role") != "assistant":
        return history, brief
    line = brief or "It is your turn in this conversation."
    return [*history, {"role": "user", "content": line}], ""


async def execute_turn(session: AsyncSession, turn: AgentTurn) -> dict[str, Any]:
    """Run one claimed turn to the end and queue whatever it asked for."""
    from app.services.agent.style import strip_emoji
    from app.services.agent.turn import is_pass
    from app.services.assistant_threads import signal_chat_history
    from app.services.chat_runtime import build_agent_loop
    from app.services.participants import serialize_participants

    signal = await session.get(Signal, turn.signal_id)
    agent = await session.get(Agent, turn.agent_id)
    if signal is None or agent is None or not agent.is_active:
        await _fail_turn(session, turn.id, "missing")
        return {"ok": False, "outcome": "missing"}

    run = AgentRun(
        tenant_id=signal.tenant_id,
        agent_id=agent.id,
        status="running",
        trigger_type="participant_turn",
        trigger_id=str(signal.id),
        subject=(signal.subject or "")[:200],
        signal_id=signal.id,
    )
    session.add(run)
    turn.run_id = run.id
    session.add(turn)
    await session.commit()
    try:
        from app.services.workforce_runtime import mark_agent_activity

        await mark_agent_activity(
            session, agent, status="working", summary="Replying", signal_id=signal.id, activity_id=run.id
        )
        await session.commit()
    except Exception:  # noqa: BLE001
        logger.debug("working presence for agent turn failed", exc_info=True)

    brief, attachments = await _turn_brief(session, turn, agent)
    peers = await serialize_participants(session, signal.tenant_id, signal.id)
    peer_line = ", ".join(
        f"{p.get('name') or p.get('kind')} ({p.get('kind')})"
        for p in peers
        if p.get("ref_id") and str(p.get("ref_id")) != str(agent.id)
    )
    extra = (
        "## Your turn in this conversation\n"
        f"You are {agent.name}. Also here: {peer_line or 'nobody else'}.\n"
        f"{brief}\n"
        "Your reply is saved as one chat bubble everyone here reads. "
        "To ask another agent something, call ask_agent; to give the "
        "conversation to another agent, call handoff_to. An @mention is only "
        "a link and wakes nobody. If there is nothing for you to say, reply "
        "with exactly: pass"
    )
    asks = await _open_asks_block(session, signal.id, agent.id)
    if asks:
        extra += f"\n\n{asks}"

    loop = build_agent_loop(
        session,
        tenant_id=signal.tenant_id,
        user_id=turn.requested_by_id if turn.requested_by_kind == "user" else None,
        agent=agent,
        signal_id=signal.id,
        trust="agent",
        surface="participant_turn",
        reply_mode="chat",
        run=run,
    )
    loop.agent_turn_id = turn.id
    history = await signal_chat_history(session, signal.id, compact=True, for_agent_id=agent.id)
    history, _ = close_on_brief(history, brief)

    previous_text = await _last_text_by(session, signal.id, agent.id)
    done: dict[str, Any] = {}
    error: Exception | None = None
    try:
        async for event in loop.stream_chat(history, extra_context=extra, attachments=attachments or None, skip_rag=True):
            if event.get("type") == "done":
                done = event
    except Exception as exc:  # noqa: BLE001
        logger.exception("agent turn %s failed", turn.id)
        error = exc
        await session.rollback()
        for obj in (signal, agent, run, turn):
            await session.refresh(obj)

    tokens = done.get("usage") or {}
    spent = int(tokens.get("input_tokens") or 0) + int(tokens.get("output_tokens") or 0)
    cancelled = bool(done.get("cancelled")) or await _turn_cancelled(session, turn.id)
    spoken = [str(seg.get("text") or "").strip() for seg in (loop.turn.segments if loop.turn else [])]
    spoken = [line for line in spoken if line]
    has_activity = bool(loop.turn and loop.turn.all_activity())
    final = strip_emoji(" ".join(spoken)).strip()
    passed = is_pass(final)

    outcome = "spoke"
    if error is not None:
        outcome = "error"
        already = "Your previous turn stopped" in (turn.prompt or "")
        await _seal_failed_turn(
            session, loop, signal, agent, exc=error, recover=not already
        )
    elif cancelled:
        outcome = "cancelled"
        reason = (
            await session.execute(select(AgentTurn.outcome).where(AgentTurn.id == turn.id))
        ).scalar_one_or_none()
        await _close_live_turn(loop, "superseded" if reason == "superseded" else "cancelled")
        if spoken or has_activity:
            await loop.persist_turn(signal, final_metadata={"cancelled": True, "participant_turn": True})
    elif passed or (not spoken and not has_activity):
        outcome = "silent"
        await _close_live_turn(loop, "silent")
    else:
        if previous_text and _same_line(previous_text, final):
            outcome = "stalled"
        thinking = loop.thinking_payload()
        await loop.persist_turn(
            signal,
            fallback_text=final or "Done.",
            final_metadata={
                "usage": tokens,
                "participant_turn": True,
                **({"thinking": thinking} if thinking else {}),
            },
        )

    run.status = {"error": "failed", "cancelled": "cancelled"}.get(outcome, "completed")
    run.completed_at = utcnow()
    run.tokens_input = int(tokens.get("input_tokens") or 0)
    run.tokens_output = int(tokens.get("output_tokens") or 0)
    session.add(run)

    row = await session.get(AgentTurn, turn.id)
    if row is not None and row.status == "running":
        row.status = "failed" if outcome == "error" else "done"
    if row is not None:
        row.outcome = outcome if row.outcome != "stopped" else row.outcome
        row.tokens = spent
        row.finished_at = utcnow()
        row.lease_until = None
        session.add(row)
    await session.flush()

    if row is not None and row.ask_id and row.cause_kind == "ask":
        await _answer_ask(session, signal, row, loop, spoken, outcome)
    if outcome == "stalled":
        await post_episode_stop(session, signal, row.episode_id if row else None)

    await sync_floor(session, signal)
    open_turns = (
        await session.execute(
            select(AgentTurn.id).where(
                AgentTurn.signal_id == signal.id, AgentTurn.status.in_(("queued", "running"))
            )
        )
    ).first()
    if open_turns is None:
        from app.services.agent.run_cancel import clear_cancel

        clear_cancel(run.id)
    await session.commit()
    try:
        from app.services.workforce_runtime import mark_agent_activity

        await mark_agent_activity(session, agent, status="standby", summary=None)
        await session.commit()
    except Exception:  # noqa: BLE001
        logger.debug("standby after agent turn failed", exc_info=True)
    return {"ok": outcome != "error", "outcome": outcome, "agent_id": str(agent.id)}


async def _turn_cancelled(session: AsyncSession, turn_id: UUID) -> bool:
    status = (
        await session.execute(select(AgentTurn.status).where(AgentTurn.id == turn_id))
    ).scalar_one_or_none()
    return status == "cancelled"


async def _last_text_by(session: AsyncSession, signal_id: UUID, agent_id: UUID) -> str:
    return (
        await session.execute(
            select(SignalMessage.body_text)
            .where(
                SignalMessage.signal_id == signal_id,
                SignalMessage.author_agent_id == agent_id,
                SignalMessage.kind == "agent_message",
            )
            .order_by(SignalMessage.seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none() or ""


def _same_line(a: str, b: str) -> bool:
    from difflib import SequenceMatcher

    from app.services.agent.turn import _normalized_line

    left, right = _normalized_line(a), _normalized_line(b)
    if not left or not right:
        return False
    return left == right or SequenceMatcher(None, left, right).ratio() >= 0.9


async def _close_live_turn(loop: Any, outcome: str) -> None:
    """``turn.completed`` for a turn that ends without reaching its own finish."""
    if loop.turn is None:
        return
    try:
        await loop.turn.finish(outcome)
    except Exception:  # noqa: BLE001
        logger.debug("closing live turn failed", exc_info=True)


def recovery_prompt(brief: str) -> str:
    """What the agent hears after its own turn died, so it can speak or try once more."""
    return (
        "Your previous turn stopped before you could finish. "
        f"What failed: {brief}. "
        "Tell the operator in one or two sentences, in their language, that it did not work. "
        "If a simpler tool call can still do what they asked, try that once and then say what you did. "
        "If you cannot, say what they can try. "
        "Do not paste internal errors, class names, or stack traces. Do not pass."
    )


async def _queue_recovery(
    session: AsyncSession, signal: Signal, agent: Agent, brief: str
) -> bool:
    """One recovery per thread per minute. A second crash in that minute does not loop."""
    stamp = utcnow().strftime("%Y%m%d%H%M")
    try:
        queued = await enqueue_turn(
            session,
            signal,
            agent_id=agent.id,
            cause_kind="system",
            prompt=recovery_prompt(brief),
            requested_by_kind="system",
            idempotency_key=f"recover:{signal.id}:{stamp}",
        )
    except Exception:  # noqa: BLE001
        logger.exception("queue recovery after a failed turn failed for %s", signal.id)
        return False
    return bool(queued.get("ok"))


async def _seal_failed_turn(
    session: AsyncSession,
    loop: Any,
    signal: Signal,
    agent: Agent,
    *,
    exc: BaseException | None = None,
    recover: bool = True,
) -> None:
    from app.services.assistant_threads import append_signal_chat_message
    from app.services.run_errors import failure_brief

    error_text = (
        "The assistant encountered an error while generating a reply. "
        "Please try again in a moment."
    )
    await _close_live_turn(loop, "error")
    if recover and await _queue_recovery(session, signal, agent, failure_brief(exc)):
        return
    try:
        if loop.turn is not None and (loop.turn.segments or loop.turn.all_activity()):
            await loop.persist_turn(
                signal,
                metadata={"error": True, "participant_turn": True},
                final_metadata={"error": True, "participant_turn": True},
                fallback_text=error_text,
            )
        else:
            await append_signal_chat_message(
                session,
                signal,
                role="assistant",
                content=error_text,
                author_agent_id=agent.id,
                metadata={"error": True, "participant_turn": True},
            )
    except Exception:  # noqa: BLE001
        logger.exception("seal after agent turn failure failed for %s", signal.id)


async def _answer_ask(
    session: AsyncSession,
    signal: Signal,
    turn: AgentTurn,
    loop: Any,
    spoken: list[str],
    outcome: str,
) -> None:
    """Store the answer on the ask and give the asker its next turn."""
    ask = await session.get(AgentAsk, turn.ask_id)
    if ask is None or ask.status != "open":
        return
    images = loop.turn.image_urls() if loop.turn is not None else []
    parts: list[dict[str, Any]] = [{"type": "text", "text": line} for line in spoken]
    parts.extend({"type": "image", "url": url, "mime": _mime_for(url)} for url in images)
    answered = outcome in ("spoke", "stalled") and bool(parts)
    ask.status = "answered" if answered else "cancelled"
    ask.answer_text = "\n\n".join(spoken)[:8000]
    ask.answer_json = json.dumps(parts)
    ask.answered_at = utcnow()
    session.add(ask)
    await session.flush()
    if outcome in ("cancelled", "error") and not answered:
        return
    await enqueue_turn(
        session,
        signal,
        agent_id=ask.from_agent_id,
        cause_kind="answer",
        requested_by_kind="agent",
        requested_by_id=ask.to_agent_id,
        ask_id=ask.id,
        episode_id=turn.episode_id,
        idempotency_key=f"answer:{ask.id}",
    )


def _mime_for(url: str) -> str:
    lowered = url.lower().split("?", 1)[0]
    if lowered.endswith(".jpg") or lowered.endswith(".jpeg"):
        return "image/jpeg"
    if lowered.endswith(".webp"):
        return "image/webp"
    if lowered.endswith(".gif"):
        return "image/gif"
    return "image/png"


# -- inline turns (Ask, inbound handling) --------------------------------------------


async def begin_inline_turn(
    bind: AsyncEngine | None,
    *,
    tenant_id: UUID,
    signal_id: UUID,
    agent_id: UUID,
    requested_by_id: UUID | None,
) -> UUID | None:
    """Record a turn that runs outside the queue, so peers wait for it.

    Its own short transaction; None when another turn already runs here.
    """
    if bind is None or bind.dialect.name != "postgresql":
        return None
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    try:
        async with _Session(bind=bind, expire_on_commit=False) as side:
            await side.execute(text("SET LOCAL lock_timeout = '1500ms'"))
            episode = await latest_human_message_id(side, signal_id)
            now = utcnow()
            row = AgentTurn(
                tenant_id=tenant_id,
                signal_id=signal_id,
                agent_id=agent_id,
                cause_kind="inline",
                requested_by_kind="user" if requested_by_id else "system",
                requested_by_id=requested_by_id,
                episode_id=episode,
                status="running",
                started_at=now,
                lease_until=now + timedelta(seconds=INLINE_LEASE_S),
                attempt=1,
                idempotency_key=f"inline:{uuid.uuid4()}",
            )
            side.add(row)
            await side.flush()
            signal = await side.get(Signal, signal_id)
            if signal is not None:
                await sync_floor(side, signal)
            await side.commit()
            _HELD[row.id] = "inline"
            return row.id
    except Exception:  # noqa: BLE001
        logger.info("inline turn not recorded for %s", signal_id)
        return None


async def end_inline_turn(
    bind: AsyncEngine | None,
    turn_id: UUID | None,
    *,
    outcome: str = "spoke",
    tokens: int = 0,
) -> None:
    if turn_id is not None:
        _HELD.pop(turn_id, None)
    if bind is None or turn_id is None:
        return
    from sqlalchemy.ext.asyncio import AsyncSession as _Session

    try:
        async with _Session(bind=bind, expire_on_commit=False) as side:
            await side.execute(text("SET LOCAL lock_timeout = '1500ms'"))
            row = await side.get(AgentTurn, turn_id)
            if row is None or row.status != "running":
                return
            row.status = "done"
            row.outcome = outcome
            row.tokens = tokens
            row.finished_at = utcnow()
            row.lease_until = None
            side.add(row)
            await side.flush()
            signal_id = row.signal_id
            signal = await side.get(Signal, signal_id)
            floor = await sync_floor(side, signal) if signal is not None else {}
            await side.commit()
    except Exception:  # noqa: BLE001
        logger.info("inline turn %s not closed; the sweep will", turn_id)
        return
    if floor.get("turn_id"):
        await ring(signal_id)


async def extend_lease(session: AsyncSession, turn_id: UUID | None, *, inline: bool = False) -> None:
    if turn_id is None:
        return
    seconds = INLINE_LEASE_S if inline else LEASE_S
    await session.execute(
        update(AgentTurn)
        .where(AgentTurn.id == turn_id, AgentTurn.status == "running")
        .values(lease_until=utcnow() + timedelta(seconds=seconds))
    )


# -- shutdown ---------------------------------------------------------------------------


async def release_held() -> dict[str, int]:
    """Process shutdown: every running turn goes back on the queue.

    A restart is not the turn's fault, so the attempt is not counted. Operator
    chats run inline in this process; ending them here dropped the agent with
    no reply. They are queued again, the same as worker turns. The open turn
    closes on the thread log at once and the next worker gets a bell.
    """
    from app.db.session import async_session_factory
    from app.services import thread_log

    held = dict(_HELD)
    _HELD.clear()
    stats = {"requeued": 0, "ended": 0}
    if not held:
        return stats
    requeued: set[UUID] = set()
    async with async_session_factory() as session:
        rows = (
            await session.execute(
                select(AgentTurn).where(AgentTurn.id.in_(list(held)), AgentTurn.status == "running")
            )
        ).scalars().all()
        touched: set[UUID] = set()
        for row in rows:
            if held.get(row.id) == "queue":
                row.status = "queued"
                row.outcome = "requeued"
                row.attempt = max(0, int(row.attempt or 0) - 1)
                row.finished_at = None
                requeued.add(row.signal_id)
                stats["requeued"] += 1
            else:
                # Operator Ask / thread reply. The process that was streaming
                # it is gone; the worker runs it from the conversation.
                row.status = "queued"
                row.outcome = "requeued"
                row.attempt = max(0, int(row.attempt or 0) - 1)
                row.finished_at = None
                if row.cause_kind == "inline":
                    row.cause_kind = "human"
                    if row.cause_message_id is None and row.episode_id is not None:
                        row.cause_message_id = row.episode_id
                requeued.add(row.signal_id)
                stats["requeued"] += 1
            row.lease_until = None
            session.add(row)
            touched.add(row.signal_id)
        await session.flush()
        for signal_id in touched:
            signal = await session.get(Signal, signal_id)
            if signal is None:
                continue
            await thread_log.close_open_turns(
                signal.tenant_id,
                signal.id,
                reason="superseded" if signal_id in requeued else "error",
            )
            await sync_floor(session, signal)
        await session.commit()
    for signal_id in requeued:
        await ring(signal_id)
    return stats


# -- sweep ------------------------------------------------------------------------------


async def sweep(session: AsyncSession) -> dict[str, int]:
    """Expired leases go back to the queue (or fail); lost bells ring again."""
    from app.services.agent.turn_persist import end_dead_turns

    now = utcnow()
    stats = {"requeued": 0, "failed": 0, "rung": 0, "dropped": 0}
    expired = (
        await session.execute(
            select(AgentTurn).where(AgentTurn.status == "running", AgentTurn.lease_until < now)
        )
    ).scalars().all()
    touched: set[UUID] = set()
    for row in expired:
        if int(row.attempt or 0) < MAX_ATTEMPTS:
            row.status = "queued"
            row.outcome = "requeued"
            if row.cause_kind == "inline":
                row.cause_kind = "human"
                if row.cause_message_id is None and row.episode_id is not None:
                    row.cause_message_id = row.episode_id
            stats["requeued"] += 1
        else:
            row.status = "failed"
            row.outcome = "lease"
            stats["failed"] += 1
        row.lease_until = None
        row.finished_at = now if row.status != "queued" else None
        session.add(row)
        touched.add(row.signal_id)
    stale = (
        await session.execute(
            select(AgentTurn).where(
                AgentTurn.status == "queued",
                AgentTurn.created_at < now - timedelta(seconds=QUEUED_MAX_AGE_S),
            )
        )
    ).scalars().all()
    for row in stale:
        row.status = "cancelled"
        row.outcome = "stale"
        row.finished_at = now
        session.add(row)
        touched.add(row.signal_id)
        stats["dropped"] += 1
    await session.flush()
    for signal_id in touched:
        signal = await session.get(Signal, signal_id)
        if signal is None:
            continue
        await end_dead_turns(session, signal, older_than=timedelta(seconds=LEASE_S))
        await sync_floor(session, signal)
    waiting = (
        await session.execute(
            select(AgentTurn.signal_id)
            .where(
                AgentTurn.status == "queued",
                AgentTurn.created_at < now - timedelta(seconds=REBELL_AFTER_S),
            )
            .distinct()
        )
    ).scalars().all()
    await session.commit()
    for signal_id in {*waiting, *touched}:
        running = (
            await session.execute(
                select(AgentTurn.id).where(
                    AgentTurn.signal_id == signal_id, AgentTurn.status == "running"
                )
            )
        ).first()
        if running is None:
            await ring(signal_id)
            stats["rung"] += 1
    return stats
