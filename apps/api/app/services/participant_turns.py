"""Multi-agent floor: request a participant turn (Grok-style SENT/PASS/TIMEOUT)."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_thread_presence, publish_thread_update
from app.models.agent import Agent
from app.models.signal import Signal, SignalEvent
from app.services.chat_runtime import build_agent_loop
from app.services.participants import ensure_participant, serialize_participants

logger = logging.getLogger(__name__)

MAX_CONSECUTIVE_TURNS = 4
DEFAULT_DEADLINE_S = 120


def _parse_active(signal: Signal) -> dict[str, Any]:
    try:
        data = json.loads(signal.active_turn_json or "{}")
    except json.JSONDecodeError:
        data = {}
    return data if isinstance(data, dict) else {}


def clear_active_turn(signal: Signal, *, reset_streak: bool = False) -> None:
    """Clear the open floor. Keep ``streak`` so A2A ping-pong still hits the cap."""
    if reset_streak:
        signal.active_turn_json = "{}"
        return
    active = _parse_active(signal)
    streak = int(active.get("streak") or 0)
    streak_at = str(active.get("streak_at") or "").strip()
    if streak > 0:
        remnant: dict[str, Any] = {"streak": streak}
        if streak_at:
            remnant["streak_at"] = streak_at
        signal.active_turn_json = json.dumps(remnant)
    else:
        signal.active_turn_json = "{}"


async def clear_ask_floor_chip(
    session: AsyncSession,
    signal: Signal,
    *,
    agent_id: UUID | None,
) -> bool:
    """Drop a UI-only floor chip after Ask/chat finishes for ``agent_id``.

    Internal Ask sets ``active_turn`` with ``run=false`` so the header can show
    “Waiting on …”. That chip has no ``claimed_at`` and is never cleared by the
    worker path — without this, the client invents a stuck “Nadenken” row.
    Does not touch deferred / claimed worker floors (peer baton).
    """
    if agent_id is None:
        return False
    floor = _parse_active(signal)
    if not floor.get("ref_id") or not floor.get("nonce"):
        return False
    if str(floor.get("ref_id")) != str(agent_id):
        return False
    if floor.get("kind") not in (None, "agent", "agent_id"):
        return False
    # Worker / deferred peer turns must keep the floor.
    if floor.get("claimed_at") or floor.get("deferred") or floor.get("enqueued"):
        return False
    clear_active_turn(signal)
    session.add(signal)
    try:
        await publish_thread_presence(
            signal.tenant_id,
            signal.id,
            phase="idle",
            actor_kind="agent",
            actor_id=str(agent_id),
            actor_name=str(floor.get("name") or ""),
            item={"active_turn": None},
        )
        await publish_thread_update(signal)
    except Exception:  # noqa: BLE001
        logger.debug("publish clear ask floor failed", exc_info=True)
    return True


def _next_chain_streak(active: dict[str, Any], *, requested_by_kind: str) -> int:
    """Count agent↔agent floors in one chain; user starts fresh; idle remnant expires."""
    if requested_by_kind == "user":
        return 1
    prev = int(active.get("streak") or 0)
    if prev <= 0:
        return 1
    raw = str(active.get("streak_at") or "").strip()
    if raw:
        try:
            at = datetime.fromisoformat(raw.replace("Z", ""))
            if datetime.utcnow() - at > timedelta(minutes=10):
                return 1
        except ValueError:
            return 1
    return prev + 1


def _deadline_expired(floor: dict[str, Any]) -> bool:
    raw = str(floor.get("deadline") or "").strip()
    if not raw:
        return False
    try:
        deadline = datetime.fromisoformat(raw.replace("Z", ""))
    except ValueError:
        return False
    return datetime.utcnow() >= deadline


def _same_open_floor(
    active: dict[str, Any],
    *,
    member_kind: str,
    member_ref_id: UUID,
) -> bool:
    if not active.get("ref_id") or not active.get("nonce"):
        return False
    if active.get("kind") != member_kind or active.get("ref_id") != str(member_ref_id):
        return False
    return not _deadline_expired(active)


# Opener must persist before the peer runs. The safety job waits this long
# so it does not start the peer mid-sentence (and race the flush job).
PEER_DEFER_SAFETY_S = 20


def wake_requester_after_peer(outcome: str) -> bool:
    """A sent reply is already in the thread. Only a silent pass needs a follow-up line."""
    return outcome == "pass"


def deferred_job_block(active: dict[str, Any]) -> str | None:
    """Return an error when a worker job must not start this floor yet.

    A deferred peer waits for the opener to persist. After
    ``PEER_DEFER_SAFETY_S`` the same job may run anyway, in case flush never
    happened.
    """
    if not active.get("deferred"):
        return None
    raw = str(active.get("streak_at") or "").strip()
    started: datetime | None = None
    if raw:
        try:
            started = datetime.fromisoformat(raw)
        except ValueError:
            started = None
    # Safety job is queued at PEER_DEFER_SAFETY_S. A slightly early tick
    # must still run; an immediate tick while the opener is writing must not.
    if started is not None and datetime.utcnow() - started < timedelta(seconds=PEER_DEFER_SAFETY_S - 1):
        return "still_deferred"
    return None


def claim_active_turn(
    signal: Signal,
    *,
    nonce: str,
) -> dict[str, Any] | None:
    """Atomically mark the open floor as claimed for ``nonce``.

    Returns the claimed floor dict, or ``None`` when the nonce is stale,
    already claimed, or the deadline passed. Callers must ``flush`` after.
    """
    active = _parse_active(signal)
    if not nonce or active.get("nonce") != nonce:
        return None
    if active.get("claimed_at"):
        return None
    if _deadline_expired(active):
        return None
    claimed = {
        **active,
        "claimed_at": datetime.utcnow().isoformat(),
        "deferred": False,
    }
    signal.active_turn_json = json.dumps(claimed)
    return claimed


async def request_participant_turn(
    session: AsyncSession,
    signal: Signal,
    *,
    member_kind: str,
    member_ref_id: UUID,
    prompt: str = "",
    deadline_s: int = DEFAULT_DEADLINE_S,
    requested_by_kind: str = "agent",
    requested_by_id: UUID | None = None,
    run: bool = True,
    enqueue: bool = True,
    defer_peer: bool | None = None,
) -> dict[str, Any]:
    """Give the floor to a participant agent and optionally run their turn.

    When an *agent* requests a peer turn mid-loop, the floor is claimed with
    ``deferred=True`` so the peer starts only after the caller persists (see
    ``flush_deferred_participant_turn``). System/user wakes enqueue immediately.
    Nested handoffs pass ``defer_peer=False`` because the opener already
    persisted before ``nest_handoff``.

    When ``run`` and ``enqueue`` are true (non-deferred), the turn is queued on
    the ARQ worker. If Redis is down, the turn runs in-process.
    """
    if member_kind != "agent":
        return {"ok": False, "error": "Only agent participants can take a turn today"}
    agent = await session.get(Agent, member_ref_id)
    if agent is None or agent.tenant_id != signal.tenant_id:
        return {"ok": False, "error": "Agent not found"}

    await ensure_participant(
        session,
        signal,
        kind="agent",
        ref_id=member_ref_id,
        role="member",
        invited_by_kind=requested_by_kind,
        invited_by_id=requested_by_id,
        joined_via="turn",
    )

    active = _parse_active(signal)
    # Idempotent: do not stack a second turn for the same agent while one is open.
    if _same_open_floor(active, member_kind=member_kind, member_ref_id=member_ref_id):
        peers = await serialize_participants(session, signal.tenant_id, signal.id)
        return {
            "ok": True,
            "outcome": "already_active",
            "active_turn": active,
            "peers": peers,
            "agent_id": str(member_ref_id),
            "agent_name": agent.name,
            "note": (
                f"{agent.name} already has the floor. "
                "Finish your short handoff; they will reply after you."
            ),
        }

    streak = _next_chain_streak(active, requested_by_kind=requested_by_kind)
    if streak > MAX_CONSECUTIVE_TURNS:
        clear_active_turn(signal, reset_streak=True)
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="participant_turn_timeout",
                actor_type=requested_by_kind or "system",
                actor_id=str(requested_by_id or ""),
                payload_json=json.dumps(
                    {
                        "reason": "max_consecutive",
                        "member_kind": member_kind,
                        "member_ref_id": str(member_ref_id),
                        "agent_name": agent.name,
                        "streak": streak,
                    }
                ),
            )
        )
        await session.flush()
        return {
            "ok": False,
            "error": "max_consecutive_turns",
            "outcome": "timeout",
            "hint": "Ask a human with create_decision_request",
        }

    nonce = str(uuid.uuid4())
    deadline = datetime.utcnow() + timedelta(
        seconds=max(15, min(int(deadline_s or DEFAULT_DEADLINE_S), 600))
    )
    peers = await serialize_participants(session, signal.tenant_id, signal.id)
    # Agent callers are mid-turn; defer the peer until the caller persists.
    # Nested batons set defer_peer=False (opener already wrote their bubble).
    defer = (
        bool(defer_peer)
        if defer_peer is not None
        else bool(run and requested_by_kind == "agent")
    )
    now_iso = datetime.utcnow().isoformat()
    floor = {
        "kind": member_kind,
        "ref_id": str(member_ref_id),
        "name": agent.name,
        "nonce": nonce,
        "deadline": deadline.isoformat(),
        "prompt": (prompt or "").strip()[:2000],
        "requested_by_kind": requested_by_kind,
        "requested_by_id": str(requested_by_id) if requested_by_id else None,
        "streak": streak,
        "streak_at": now_iso,
        "deferred": defer,
    }
    signal.active_turn_json = json.dumps(floor)
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type="participant_turn_requested",
            actor_type=requested_by_kind or "system",
            actor_id=str(requested_by_id or ""),
            payload_json=json.dumps(floor),
        )
    )
    await session.flush()
    try:
        await publish_thread_presence(
            signal.tenant_id,
            signal.id,
            phase="thinking",
            actor_kind="agent",
            actor_id=str(member_ref_id),
            actor_name=agent.name,
            item={"active_turn": floor},
        )
    except Exception:  # noqa: BLE001
        logger.debug("publish active_turn failed", exc_info=True)

    if not run:
        return {"ok": True, "outcome": "requested", "active_turn": floor, "peers": peers}

    if defer:
        # Safety net only: Ask/child sessions persist on a child signal, so
        # host ``flush_deferred_participant_turn`` may never run. Host-thread
        # persist flushes immediately and claims first — the delayed job then
        # exits as already_claimed / stale_nonce (no second bubble).
        floor = {**floor, "enqueued": True}
        signal.active_turn_json = json.dumps(floor)
        session.add(signal)
        await session.flush()
        started = await _start_or_enqueue_turn(
            session,
            signal,
            agent=agent,
            prompt=prompt,
            nonce=nonce,
            requested_by_kind=requested_by_kind,
            requested_by_id=requested_by_id,
            peers=peers,
            enqueue=enqueue,
            floor=floor,
            defer_by_s=PEER_DEFER_SAFETY_S,
        )
        if started.get("outcome") in ("queued", "deferred"):
            started = {
                **started,
                "outcome": "deferred",
                "note": (
                    f"{agent.name} will take the floor after you finish this message. "
                    "Write one short handoff that includes what the human asked, then stop. "
                    "They answer the human. Do not wait to summarize their reply."
                ),
            }
        return started

    return await _start_or_enqueue_turn(
        session,
        signal,
        agent=agent,
        prompt=prompt,
        nonce=nonce,
        requested_by_kind=requested_by_kind,
        requested_by_id=requested_by_id,
        peers=peers,
        enqueue=enqueue,
        floor=floor,
    )


async def _start_or_enqueue_turn(
    session: AsyncSession,
    signal: Signal,
    *,
    agent: Agent,
    prompt: str,
    nonce: str,
    requested_by_kind: str,
    requested_by_id: UUID | None,
    peers: list[dict[str, Any]],
    enqueue: bool,
    floor: dict[str, Any],
    defer_by_s: int = 0,
) -> dict[str, Any]:
    if enqueue:
        try:
            from app.config import get_settings

            if not get_settings().bokito_mock_execution:
                from app.workers.tasks import enqueue_participant_turn

                queued = await enqueue_participant_turn(
                    tenant_id=str(signal.tenant_id),
                    signal_id=str(signal.id),
                    agent_id=str(agent.id),
                    prompt=(prompt or "").strip(),
                    requested_by_kind=requested_by_kind,
                    requested_by_id=str(requested_by_id) if requested_by_id else None,
                    nonce=nonce,
                    defer_by_s=max(0, int(defer_by_s or 0)),
                )
                if queued:
                    # Keep deferred=True when delayed so flush can clear the flag
                    # after an early persist; delayed job still claims via nonce.
                    if floor.get("deferred") and defer_by_s <= 0:
                        floor = {**floor, "deferred": False}
                        signal.active_turn_json = json.dumps(floor)
                        session.add(signal)
                        await session.flush()
                    return {
                        "ok": True,
                        "outcome": "queued" if defer_by_s <= 0 else "deferred",
                        "active_turn": floor,
                        "peers": peers,
                        "agent_id": str(agent.id),
                        "agent_name": agent.name,
                    }
        except Exception:  # noqa: BLE001
            logger.debug("enqueue participant turn failed; running inline", exc_info=True)

    # Delayed path must not run inline immediately (would recreate the race).
    if defer_by_s > 0:
        return {
            "ok": True,
            "outcome": "deferred",
            "active_turn": floor,
            "peers": peers,
            "agent_id": str(agent.id),
            "agent_name": agent.name,
        }

    return await execute_participant_turn(
        session,
        signal,
        agent=agent,
        prompt=prompt,
        nonce=nonce,
        requested_by_kind=requested_by_kind,
        requested_by_id=requested_by_id,
        peers=peers,
    )


async def flush_deferred_participant_turn(
    session: AsyncSession,
    signal: Signal,
) -> dict[str, Any] | None:
    """Start a peer turn that was claimed during an agent caller's loop.

    Call after the caller's ``persist_turn`` so timeline order is:
    handoff bubble → peer work → wake summary.
    """
    floor = _parse_active(signal)
    if not floor.get("deferred") or not floor.get("ref_id") or not floor.get("nonce"):
        return None

    try:
        agent_id = UUID(str(floor["ref_id"]))
    except ValueError:
        return None
    agent = await session.get(Agent, agent_id)
    if agent is None or agent.tenant_id != signal.tenant_id:
        clear_active_turn(signal)
        session.add(signal)
        await session.flush()
        return {"ok": False, "error": "agent_missing"}

    if _deadline_expired(floor):
        clear_active_turn(signal)
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="participant_turn_timeout",
                actor_type="system",
                actor_id="",
                payload_json=json.dumps(
                    {
                        "reason": "deadline",
                        "member_kind": str(floor.get("kind") or "agent"),
                        "member_ref_id": str(agent.id),
                        "agent_name": agent.name,
                        "nonce": str(floor.get("nonce") or ""),
                    }
                ),
            )
        )
        await session.flush()
        try:
            await publish_thread_presence(
                signal.tenant_id,
                signal.id,
                phase="idle",
                actor_kind="system",
                actor_id="",
                actor_name="",
                item={"active_turn": None},
            )
            await publish_thread_update(signal)
        except Exception:  # noqa: BLE001
            pass
        return {"ok": False, "outcome": "expired"}

    requested_by_id = None
    raw_req = floor.get("requested_by_id")
    if raw_req:
        try:
            requested_by_id = UUID(str(raw_req))
        except ValueError:
            requested_by_id = None

    peers = await serialize_participants(session, signal.tenant_id, signal.id)
    nonce = str(floor.get("nonce") or "")
    # Already running — only clear the deferred flag.
    if floor.get("claimed_at"):
        floor = {**floor, "deferred": False}
        signal.active_turn_json = json.dumps(floor)
        session.add(signal)
        await session.flush()
        return {"ok": True, "outcome": "already_claimed", "active_turn": floor, "peers": peers}

    # Prefer an immediate job on persist so the peer does not wait for the
    # 3s safety enqueue. A twin job (safety net) exits via claim_active_turn.
    floor = {**floor, "deferred": False, "enqueued": True}
    signal.active_turn_json = json.dumps(floor)
    session.add(signal)
    await session.flush()

    return await _start_or_enqueue_turn(
        session,
        signal,
        agent=agent,
        prompt=str(floor.get("prompt") or ""),
        nonce=nonce,
        requested_by_kind=str(floor.get("requested_by_kind") or "agent"),
        requested_by_id=requested_by_id,
        peers=peers,
        enqueue=True,
        floor=floor,
        defer_by_s=0,
    )


async def execute_participant_turn(
    session: AsyncSession,
    signal: Signal,
    *,
    agent: Agent,
    prompt: str = "",
    nonce: str = "",
    requested_by_kind: str = "agent",
    requested_by_id: UUID | None = None,
    peers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Run the agent turn after the floor is already set."""
    # Re-validate: another worker may have claimed or cleared this nonce.
    active = _parse_active(signal)
    if nonce and active.get("nonce") != nonce:
        return {"ok": False, "error": "stale_nonce", "outcome": "stale"}
    if nonce and not active.get("claimed_at"):
        claimed = claim_active_turn(signal, nonce=nonce)
        if claimed is None:
            return {"ok": False, "error": "already_claimed", "outcome": "stale"}
        session.add(signal)
        await session.flush()
        active = claimed

    peers = peers if peers is not None else await serialize_participants(
        session, signal.tenant_id, signal.id
    )
    peer_line = ", ".join(
        f"{p.get('name') or p.get('kind')} ({p.get('kind')})" for p in peers if p.get("ref_id")
    )
    wake_back = requested_by_kind == "system"
    if wake_back:
        extra = (
            f"## Report back to the human\n"
            f"You are {agent.name}. Another participant just finished their turn.\n"
            f"Write one short message for the human summarizing what they did. "
            f"Do not pass. Do not say you are still waiting — the work is done.\n"
        )
    else:
        extra = (
            f"## Your turn in this conversation\n"
            f"You are {agent.name}. Other participants: {peer_line or 'none'}.\n"
            f"Speak with a normal chat reply — it is saved as bubbles in this thread "
            f"for everyone to read. Use post_thread_message only for an extra note. "
            f"If this is not for you, reply with exactly: pass\n"
        )
    if prompt:
        extra += f"Request: {prompt}\n"

    loop = build_agent_loop(
        session,
        tenant_id=signal.tenant_id,
        user_id=requested_by_id if requested_by_kind == "user" else None,
        agent=agent,
        signal_id=signal.id,
        trust="agent",
        surface="participant_turn",
        reply_mode="chat",
    )
    user_text = prompt or "It is your turn in this conversation. Respond or pass."
    try:
        text, tokens = await loop.run_chat(
            [{"role": "user", "content": user_text}],
            extra_context=extra,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("participant turn failed")
        clear_active_turn(signal)
        session.add(signal)
        error_text = (
            "The assistant encountered an error while generating a reply. "
            "Please try again in a moment."
        )
        had_partial = False
        # Same contract as Ask crash: never leave in_progress tool trail stuck.
        try:
            from app.services.agent.turn_persist import seal_in_progress_checkpoints

            checkpoint_id = getattr(loop, "_checkpoint_message_id", None)
            had_partial = bool(checkpoint_id) or (
                loop.turn is not None
                and bool(getattr(loop.turn, "all_activity", lambda: [])())
            )
            sealed = False
            if loop.turn is not None:
                try:
                    await loop.persist_turn(
                        signal,
                        metadata={"error": True, "participant_turn": True},
                        final_metadata={"error": True, "participant_turn": True},
                        fallback_text=error_text,
                    )
                    sealed = True
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "persist participant turn after failure failed for %s",
                        signal.id,
                    )
            if not sealed:
                rewritten = await seal_in_progress_checkpoints(
                    session,
                    signal,
                    error_text=error_text,
                    author_agent_id=agent.id,
                    replace_with_error=True,
                    checkpoint_message_id=checkpoint_id,
                )
                had_partial = had_partial or bool(rewritten)
            else:
                await seal_in_progress_checkpoints(session, signal)
        except Exception:  # noqa: BLE001
            logger.exception("seal after participant turn failure failed")
            had_partial = False
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="participant_turn_timeout",
                actor_type="agent",
                actor_id=str(agent.id),
                payload_json=json.dumps(
                    {
                        "reason": "error",
                        "error": str(exc)[:300],
                        "nonce": nonce,
                        "agent_name": agent.name,
                        "member_kind": "agent",
                        "member_ref_id": str(agent.id),
                    }
                ),
            )
        )
        await session.flush()
        try:
            await publish_thread_presence(
                signal.tenant_id,
                signal.id,
                phase="idle",
                actor_kind="agent",
                actor_id=str(agent.id),
                actor_name=agent.name,
                item={"active_turn": None},
            )
            await publish_thread_update(signal)
        except Exception:  # noqa: BLE001
            pass
        # Wake requester (or the same agent on system wake) so someone tells
        # the human and can continue unfinished tool work.
        wake_kind = requested_by_kind
        wake_id = requested_by_id
        if wake_kind != "agent" or not wake_id:
            wake_kind = "agent"
            wake_id = agent.id
        if wake_id and (had_partial or wake_id != agent.id):
            try:
                await request_participant_turn(
                    session,
                    signal,
                    member_kind="agent",
                    member_ref_id=wake_id,
                    prompt=(
                        f"{agent.name}'s turn failed before it finished "
                        f"(error for the human: {error_text[:280]}). "
                        "Tell the human in one short sentence that something went wrong, "
                        "then continue the unfinished work if you can. "
                        "Do not pass. Do not say you are still waiting."
                    ),
                    requested_by_kind="system",
                    requested_by_id=None,
                    run=True,
                    enqueue=True,
                    defer_peer=False,
                )
            except Exception:  # noqa: BLE001
                logger.debug("wake after participant turn failure failed", exc_info=True)
        return {"ok": False, "outcome": "error", "error": str(exc)[:300]}

    text = text or ""
    passed = (
        not wake_back
        and (
            text.strip().lower() in ("pass", "i pass", "skip")
            or "i pass" in text.lower()[:40]
        )
    )
    # Persist speech as inline bubbles (the previous path only ran the loop).
    if not passed:
        try:
            await loop.persist_turn(
                signal,
                fallback_text=text.strip() or "Done.",
                final_metadata={"usage": tokens, "participant_turn": True},
            )
        except Exception:  # noqa: BLE001
            logger.exception("persist participant turn failed for %s", signal.id)
    clear_active_turn(signal)
    session.add(signal)
    outcome = "pass" if passed else "sent"
    session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=signal.tenant_id,
            event_type=f"participant_turn_{outcome}",
            actor_type="agent",
            actor_id=str(agent.id),
            payload_json=json.dumps({"nonce": nonce, "agent_name": agent.name}),
        )
    )
    await session.flush()
    try:
        await publish_thread_presence(
            signal.tenant_id,
            signal.id,
            phase="idle",
            actor_kind="agent",
            actor_id=str(agent.id),
            actor_name=agent.name,
            item={"active_turn": None},
        )
        await publish_thread_update(signal)
    except Exception:  # noqa: BLE001
        pass

    # Opener baton: nest only on real agent-authored turns that still have an
    # open handoff. System wake-backs must not re-nest when the report @tags
    # the peer (that caused Extra↔Bokito ping-pong until max_consecutive).
    if (
        outcome == "sent"
        and text.strip()
        and requested_by_kind != "system"
    ):
        try:
            from app.services.handoff_sessions import get_handoff_session, nest_handoff
            from app.services.thread_dispatch import entity_mentions

            handoff = get_handoff_session(signal)
            handoff_open = bool(
                handoff and handoff.get("status") in ("open", "handed_off")
            )
            if handoff_open and len(entity_mentions(text)) >= 1:
                nested = await nest_handoff(
                    session,
                    signal.tenant_id,
                    signal,
                    body_text=text,
                    from_agent_id=agent.id,
                )
                if nested.get("ok"):
                    return {
                        "ok": True,
                        "outcome": outcome,
                        "active_turn": None,
                        "agent_id": str(agent.id),
                        "agent_name": agent.name,
                        "handoff": nested.get("handoff"),
                    }
        except Exception:  # noqa: BLE001
            logger.debug("nest handoff after participant turn failed", exc_info=True)

    # A posted reply is already in the thread. Only a silent pass wakes the
    # requester, in one line, so a skipped handoff does not stall.
    if (
        outcome in ("sent", "pass")
        and requested_by_kind == "agent"
        and requested_by_id
        and requested_by_id != agent.id
    ):
        try:
            from app.services.handoff_sessions import complete_handoff_session

            complete_handoff_session(
                signal,
                reason="peer_passed" if outcome == "pass" else "peer_replied",
            )
            session.add(signal)
            if wake_requester_after_peer(outcome):
                await request_participant_turn(
                    session,
                    signal,
                    member_kind="agent",
                    member_ref_id=requested_by_id,
                    prompt=(
                        f"{agent.name} passed on their turn (they skipped). "
                        "Tell the human in one short sentence that they skipped. "
                        "Do not pass. Do not say you are still waiting."
                    ),
                    requested_by_kind="system",
                    requested_by_id=None,
                    run=True,
                    enqueue=True,
                )
        except Exception:  # noqa: BLE001
            logger.debug("wake requester after participant turn failed", exc_info=True)

    return {
        "ok": True,
        "outcome": outcome,
        "active_turn": None,
        "agent_id": str(agent.id),
        "agent_name": agent.name,
    }
