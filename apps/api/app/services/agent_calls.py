"""Ring an available person when an agent turn places a decision card.

The card is always kept. Decline, miss and a failed voice session leave it
awaiting the same person. The voice model never receives the tool catalog.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.time import utcnow
from app.exceptions import AppError, NotFoundError, status_error
from app.models.agent import Agent
from app.models.agent_call import AgentCall
from app.models.auth import User
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.services.presence import AVAILABLE, connected_user_ids_for, visible_user_status

logger = logging.getLogger(__name__)

RINGING = "ringing"
LIVE = "live"
MISSED = "missed"
DECLINED = "declined"
ENDED = "ended"
OPEN_STATUSES = frozenset({RINGING, LIVE})
# While a tab heartbeats, no other tab can open a second voice session.
# Long enough that a background tab (timers slowed to about once a minute)
# still keeps the line.
VOICE_LEASE = timedelta(seconds=90)
_REJECT_IDS = frozenset({"reject", "rejected", "deny", "denied", "no", "decline", "dismiss"})


def calls_enabled() -> bool:
    return bool(get_settings().agent_calls_enabled)


def _call_prefs(user: User | None, agent: Agent | None = None) -> dict[str, Any]:
    from app.services.agent_call_voice import resolve_call_prefs

    return resolve_call_prefs(
        user.settings_json if user else None,
        agent_settings=agent.settings_json if agent is not None else None,
        agent_id=agent.id if agent is not None else None,
    )


async def _voice_models(session: AsyncSession, agent: Agent | None) -> dict[str, str]:
    from app.services.voice_models import resolve_voice_models

    return await resolve_voice_models(
        session,
        agent_settings=agent.settings_json if agent is not None else None,
    )


def _public_prefs(prefs: dict[str, Any]) -> dict[str, Any]:
    return {
        "voice": prefs["voice"],
        "speed": prefs["speed"],
        "language": prefs["language"],
        "voices": prefs["voices"],
        "speeds": prefs["speeds"],
        "languages": prefs["languages"],
    }


def ring_seconds() -> int:
    raw = int(get_settings().agent_call_ring_seconds or 25)
    return max(5, min(raw, 120))


def _options(decision: DecisionRequest) -> list[dict[str, Any]]:
    try:
        raw = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        return []
    return [row for row in raw if isinstance(row, dict)]


def match_option(
    options: list[dict[str, Any]],
    *,
    option_id: str | None,
    label: str | None,
) -> dict[str, Any] | None:
    wanted_id = (option_id or "").strip()
    wanted_label = (label or "").strip().lower()
    for option in options:
        if wanted_id and str(option.get("id") or "") == wanted_id:
            return option
    for option in options:
        text = str(option.get("label") or option.get("title") or "").strip().lower()
        if wanted_label and text == wanted_label:
            return option
    return None


def choice_action(option: dict[str, Any]) -> str:
    option_id = str(option.get("id") or "").strip().lower()
    style = str(option.get("style") or option.get("tone") or "").strip().lower()
    if option_id in _REJECT_IDS or style in {"reject", "danger", "destructive"}:
        return "rejected"
    return "approved"


def _person_available(user: User, connected: set[str], *, now: datetime) -> bool:
    """A call needs Online. Away and Unavailable are never rung."""
    from app.services.presence import _availability

    if _availability(user, now) != "online":
        return False
    return visible_user_status(user, connected=str(user.id) in connected, now=now) == AVAILABLE


async def _ring_user_id(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
) -> UUID | None:
    """The first person on the reach ladder who is available and lets agents call."""
    from app.services.notify import load_prefs
    from app.services.reach import in_quiet_hours, ladder

    now = utcnow()
    connected = connected_user_ids_for(tenant_id)
    signal = await session.get(Signal, decision.signal_id) if decision.signal_id else None
    people, _direct, _dept = await ladder(session, decision, signal)
    for user_id in people:
        user = await session.get(User, user_id)
        if user is None or not user.is_active or not _person_available(user, connected, now=now):
            continue
        reach = (await load_prefs(session, tenant_id, user_id)).get("reach") or {}
        if not reach.get("agents_may_call", True) or in_quiet_hours(reach, now):
            continue
        return user.id
    return None


def _call_client(client_id: str | None) -> str:
    return (client_id or "").strip()[:80] or "tab"


def _voice_held_by_other(call: AgentCall, client_id: str, now: datetime) -> bool:
    holder = (call.voice_client or "").strip()
    if not holder or holder == client_id:
        return False
    seen = call.voice_seen_at
    if seen is None:
        return False
    if seen.tzinfo is not None:
        seen = seen.replace(tzinfo=None)
    return now - seen < VOICE_LEASE


async def _claim_voice(session: AsyncSession, call: AgentCall, client_id: str | None) -> AgentCall:
    """Give this browser tab the only voice session on the call.

    A second tab gets nothing while the lease is fresh, so it cannot open
    another copy of the same agent.
    """
    client = _call_client(client_id)
    await _lock_open_line(session, call.user_id)
    fresh = await session.get(AgentCall, call.id)
    if fresh is None:
        raise NotFoundError("Call not found")
    now = utcnow()
    if _voice_held_by_other(fresh, client, now):
        raise status_error(status_code=409, detail="This call is already open in another tab")
    fresh.voice_client = client
    fresh.voice_seen_at = now
    session.add(fresh)
    await session.flush()
    return fresh


async def _lock_open_line(session: AsyncSession, user_id: UUID) -> None:
    """One open call per person. Concurrent rings wait for each other on Postgres."""
    bind = session.get_bind()
    if bind.dialect.name != "postgresql":
        return
    from sqlalchemy import text

    key = user_id.int % ((1 << 63) - 1)
    await session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": key})


async def _record_call(session: AsyncSession, call: AgentCall, status: str) -> None:
    """Every ring and its outcome is a reach event on the thread."""
    from app.services.department_domain import department_of_signal
    from app.services.reach import record_reach

    signal = await session.get(Signal, call.signal_id)
    department_id = await department_of_signal(session, signal) if signal is not None else None
    await record_reach(
        session,
        signal_id=call.signal_id,
        tenant_id=call.tenant_id,
        channel="call",
        recipient_user_id=call.user_id,
        status=status,
        department_id=department_id,
        agent_id=call.agent_id,
        decision_id=call.decision_id,
    )


def serialize_call(
    call: AgentCall,
    *,
    agent_name: str = "",
    title: str = "",
    summary: str = "",
    text: str = "",
    instructions: str = "",
) -> dict[str, Any]:
    return {
        "call_id": str(call.id),
        "status": call.status,
        "user_id": str(call.user_id),
        "agent_id": str(call.agent_id) if call.agent_id else None,
        "agent_name": agent_name,
        "signal_id": str(call.signal_id),
        "decision_id": str(call.decision_id) if call.decision_id else None,
        "run_id": str(call.run_id) if call.run_id else None,
        "title": title,
        "summary": summary,
        "text": text,
        "instructions": instructions,
        # Always stamp Z so browsers do not treat naive UTC as local time.
        "ring_until": f"{call.ring_until.isoformat()}Z" if call.ring_until else None,
    }


async def publish_call(
    call: AgentCall,
    *,
    agent_name: str = "",
    title: str = "",
    summary: str = "",
    text: str = "",
    instructions: str = "",
) -> None:
    from app.gateway.publish import _safe_publish

    await _safe_publish(
        call.tenant_id,
        ["notifications"],
        "agent.call",
        serialize_call(
            call,
            agent_name=agent_name,
            title=title,
            summary=summary,
            text=text,
            instructions=instructions,
        ),
    )


async def maybe_ring_for_decision(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
) -> AgentCall | None:
    """Incoming phone is off. The card stays; the person hears a voice message."""
    del session, tenant_id, decision
    return None


async def request_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    decision_id: UUID,
) -> AgentCall:
    """Incoming phone is off. A decision stays a card; the person hears a voice message."""
    del session, tenant_id, user_id, decision_id
    raise status_error(status_code=409, detail="Incoming calls are off")


async def _load_owned(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
) -> AgentCall:

    call = await session.get(AgentCall, call_id)
    if call is None or call.tenant_id != tenant_id or call.user_id != user_id:
        raise NotFoundError("Call not found")
    return call


async def decline_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
) -> AgentCall:

    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != RINGING:
        raise status_error(status_code=409, detail="Call is not ringing")
    call.status = DECLINED
    call.ended_at = utcnow()
    session.add(call)
    await session.flush()
    await _record_call(session, call, DECLINED)
    await publish_call(call)
    return call


async def miss_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
) -> AgentCall:
    """The open tab gave up. A live call is left alone."""
    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != RINGING:
        return call
    call.status = MISSED
    call.ended_at = utcnow()
    session.add(call)
    await session.flush()
    await _record_call(session, call, MISSED)
    await publish_call(call)
    return call


async def expire_rings(session: AsyncSession) -> int:
    """Mark rings that outlived their window. The decision card stays."""
    if not calls_enabled():
        return 0
    now = utcnow()
    rows = (
        await session.execute(
            select(AgentCall).where(
                AgentCall.status == RINGING,
                AgentCall.ring_until < now,
            )
        )
    ).scalars().all()
    for call in rows:
        call.status = MISSED
        call.ended_at = now
        session.add(call)
        await _record_call(session, call, MISSED)
        await publish_call(call)
    if rows:
        await session.commit()
    return len(rows)


async def list_ringing(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            select(AgentCall).where(
                AgentCall.tenant_id == tenant_id,
                AgentCall.user_id == user_id,
                or_(
                    (AgentCall.status == RINGING) & (AgentCall.ring_until >= utcnow()),
                    AgentCall.status == LIVE,
                ),
            )
        )
    ).scalars().all()
    out: list[dict[str, Any]] = []
    for call in rows:
        decision = await session.get(DecisionRequest, call.decision_id) if call.decision_id else None
        agent = await session.get(Agent, call.agent_id) if call.agent_id else None
        # A ring is only useful while the card is still waiting. A live call
        # stays on the line after the decision is settled, until hang-up.
        if call.status != LIVE and (decision is None or decision.status != "awaiting_human"):
            continue
        out.append(
            serialize_call(
                call,
                agent_name=agent.name if agent else "",
                title=decision.title if decision else "",
                summary=(decision.summary or "") if decision else "",
            )
        )
    out.sort(key=lambda row: 0 if row.get("status") == LIVE else 1)
    return out


# One workspace lookup per live line. A second consult_run used to start
# another full turn, and each result was spoken, so the line talked over itself.
_consulting: set[UUID] = set()
# Answers already spoken on this line, so the next question does not look them up again.
_learned: dict[UUID, list[str]] = {}
CONSULT_SECONDS = 20


def _missing_fact(language: str) -> str:
    if language == "en":
        return "I don't have that yet."
    return "Dat heb ik nu niet bij de hand."


def _remember_fact(call_id: UUID, question: str, answer: str) -> None:
    rows = _learned.setdefault(call_id, [])
    rows.append(f"Q: {question.strip()}\nA: {answer.strip()}")
    del rows[:-6]


def _learned_text(call_id: UUID) -> str:
    return "\n".join(_learned.get(call_id, []))


async def _thread_digest(session: AsyncSession, signal_id: UUID) -> str:
    """Last few spoken messages, without the lookup questions this call posted."""
    import json

    from app.models.signal import SignalMessage

    rows = (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == signal_id,
                SignalMessage.kind.in_(("user_message", "agent_message")),
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(12)
        )
    ).scalars().all()
    lines: list[str] = []
    for row in reversed(rows):
        body = " ".join((row.body_text or "").split())
        if not body:
            continue
        try:
            meta = json.loads(row.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if row.role == "user" and isinstance(meta, dict) and meta.get("source") == "agent_call":
            continue
        who = "Person" if row.kind == "user_message" else "Agent"
        if len(body) > 220:
            body = body[:220].rstrip() + "..."
        lines.append(f"{who}: {body}")
    text = "\n".join(lines[-8:])
    return text[-1600:]


async def _call_instructions(
    session: AsyncSession,
    call: AgentCall,
    *,
    agent_name: str,
    title: str,
    summary: str,
    options: list[dict[str, Any]],
    language: str,
    reconnected: bool = False,
    conversation: bool = False,
    push_to_talk: bool = False,
) -> str:
    from app.services.agent_call_voice import voice_instructions

    return voice_instructions(
        agent_name=agent_name,
        title=title,
        summary=summary,
        options=options,
        reconnected=reconnected,
        language=language,
        conversation=conversation,
        thread=await _thread_digest(session, call.signal_id),
        learned=_learned_text(call.id),
        push_to_talk=push_to_talk,
    )


def _spoken_for_call(text: str) -> str:
    """One short utterance. The thread keeps the full reply."""
    cleaned = " ".join(text.split())
    if len(cleaned) <= 360:
        return cleaned
    cut = cleaned[:360]
    dot = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if dot >= 80:
        return cut[: dot + 1]
    return cut.rstrip() + "..."


def _schedule_consult(call_id: UUID, question: str) -> bool:
    if call_id in _consulting:
        return False
    _consulting.add(call_id)
    task = asyncio.create_task(_consult_run(call_id, question))

    def _done(done: asyncio.Task) -> None:
        _consulting.discard(call_id)
        if done.cancelled():
            return
        exc = done.exception()
        if exc is not None:
            logger.exception("agent call consult failed", exc_info=exc)

    task.add_done_callback(_done)
    return True


async def _consult_run(call_id: UUID, question: str) -> None:
    from app.db.session import async_session_factory

    async with async_session_factory() as session:
        await _consult_on(session, call_id, question)


async def _consult_on(session: AsyncSession, call_id: UUID, question: str) -> None:
    """One short lookup. The voice already said nothing; this speaks the result once."""
    import asyncio

    from app.services.chat_runtime import start_agent_turn

    asked = question.strip()
    if not asked:
        return
    call = await session.get(AgentCall, call_id)
    if call is None or call.status != LIVE or call.agent_id is None:
        return
    agent = await session.get(Agent, call.agent_id)
    signal = await session.get(Signal, call.signal_id)
    if agent is None or signal is None:
        return
    decision = await session.get(DecisionRequest, call.decision_id) if call.decision_id else None
    user = await session.get(User, call.user_id)
    title = decision.title if decision else ""
    summary = (decision.summary or "") if decision else ""
    options = _options(decision) if decision is not None and decision.status == "awaiting_human" else []
    language = _call_prefs(user, agent)["language"]
    thread = await _thread_digest(session, call.signal_id)
    text = ""
    try:
        result = await asyncio.wait_for(
            start_agent_turn(
                session,
                tenant_id=call.tenant_id,
                user_id=call.user_id,
                agent=agent,
                signal=signal,
                user_text=asked,
                trust="operator",
                surface="agent_call",
                extra_system=(
                    "You are on a live call. Answer in one or two spoken sentences. "
                    "Do not say you are looking or that the person should wait. "
                    "Do not call post_internal_note. Do not open a decision.\n"
                    f"Conversation:\n{thread}"
                ),
            ),
            timeout=CONSULT_SECONDS,
        )
        text = str(result.get("text") or "").strip()
    except asyncio.TimeoutError:
        text = ""
    except Exception:
        logger.exception("agent call consult failed")
        text = ""
    await session.commit()
    fresh = await session.get(AgentCall, call_id)
    if fresh is None or fresh.status != LIVE:
        return
    if text:
        spoken = _spoken_for_call(text)
        _remember_fact(call_id, asked, spoken)
    else:
        spoken = _missing_fact(language)
    await publish_call(
        fresh,
        agent_name=agent.name,
        text=spoken,
        title=title,
        summary=summary,
        instructions=await _call_instructions(
            session,
            fresh,
            agent_name=agent.name,
            title=title,
            summary=summary,
            options=options,
            language=language,
            reconnected=True,
            conversation=not title.strip(),
        ),
    )


async def run_call_tool(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
    *,
    name: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:

    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != LIVE:
        raise status_error(status_code=409, detail="Call is not live")
    if name == "consult_run":
        question = str(arguments.get("question") or "").strip()
        if not question:
            raise AppError("question is required", code="app_error", status_code=400)
        if not _schedule_consult(call.id, question):
            return {
                "status": "already_looking",
                "say": "Already checking. Stay quiet. Do not call consult_run again.",
            }
        return {
            "status": "looking",
            "say": "Stay quiet. Wait for the run update. Do not call consult_run again.",
        }
    if name == "confirm_choice":
        return await _confirm_choice(session, call, arguments)
    if name == "hang_up":
        raw = arguments.get("transcript")
        await end_call(
            session,
            tenant_id,
            user_id,
            call_id,
            transcript=raw if isinstance(raw, list) else None,
        )
        return {"status": "ended"}
    raise AppError("Unknown call tool", code="app_error", status_code=400)


async def _confirm_choice(
    session: AsyncSession,
    call: AgentCall,
    arguments: dict[str, Any],
) -> dict[str, Any]:

    from app.services.signal_threads import resolve_message_decision

    if call.decision_id is None:
        return {"status": "no_decision", "say": "There is no open decision on this call."}
    decision = await session.get(DecisionRequest, call.decision_id)
    if decision is None or decision.signal_id is None or decision.message_id is None:
        raise NotFoundError("Decision not found")
    if decision.status != "awaiting_human":
        return {"status": "already_resolved", "decision_status": decision.status}
    option = match_option(
        _options(decision),
        option_id=str(arguments.get("option_id") or "") or None,
        label=str(arguments.get("label") or "") or None,
    )
    if option is None:
        raise AppError("Option not found", code="app_error", status_code=400)
    action = choice_action(option)
    await resolve_message_decision(
        session,
        call.tenant_id,
        call.user_id,
        decision.signal_id,
        decision.message_id,
        action=action,
        option_id=str(option.get("id") or "") or None,
        source="agent_call",
    )
    label = str(option.get("label") or option.get("id") or "")
    return {"status": "resolved", "action": action, "label": label}


async def _file_call_log(session: AsyncSession, signal, call: AgentCall, lines: list[dict[str, str]]) -> None:
    """One collapsible call log on the thread. A second end appends lines."""
    from app.models.signal import SignalMessage

    existing = (
        await session.execute(
            select(SignalMessage)
            .where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.tenant_id == call.tenant_id,
                SignalMessage.kind == "system_event",
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(20)
        )
    ).scalars().all()
    target = None
    meta: dict[str, Any] = {}
    for message in existing:
        try:
            parsed = json.loads(message.metadata_json or "{}")
        except json.JSONDecodeError:
            continue
        if str(parsed.get("agent_call_id") or "") == str(call.id):
            target = message
            meta = parsed
            break
    if target is None:
        stored: list[dict[str, str]] = []
        target = SignalMessage(
            signal_id=signal.id,
            tenant_id=call.tenant_id,
            kind="system_event",
            direction="internal",
            role="assistant",
            author_agent_id=call.agent_id,
            body_text="",
            metadata_json="{}",
        )
        session.add(target)
    else:
        try:
            meta = json.loads(target.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        stored = list((meta.get("call_log") or {}).get("lines") or [])
    seen = {row.get("text") for row in stored}
    for line in lines:
        if line["text"] not in seen:
            stored.append(line)
            seen.add(line["text"])
    summary = stored[-1]["text"] if stored else "Call"
    target.body_text = summary[:240]
    target.body_preview = target.body_text[:200]
    start = call.answered_at or call.created_at
    end = call.ended_at or utcnow()
    seconds = max(0, int((end - start).total_seconds())) if start is not None else 0
    previous_started = str((meta.get("call_log") or {}).get("started_at") or "")
    started = previous_started or (f"{start.isoformat()}Z" if start is not None else "")
    target.metadata_json = json.dumps(
        {
            "source": "agent_call",
            "agent_call_id": str(call.id),
            "call_log": {
                "lines": stored[:40],
                "summary": summary[:240],
                "started_at": started,
                "duration_seconds": seconds,
            },
        }
    )
    session.add(target)
    await session.flush()


async def end_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
    *,
    transcript: list[dict[str, Any]] | None = None,
) -> AgentCall:
    _learned.pop(call_id, None)
    call = await _load_owned(session, tenant_id, user_id, call_id)
    # A hang-up ends the call before the goodbye line is transcribed.
    # A second end still files those lines.
    already_ended = call.status not in OPEN_STATUSES
    signal = await session.get(Signal, call.signal_id)
    fresh: list[dict[str, str]] = []
    if signal is not None:
        for line in (transcript or [])[:40]:
            if not isinstance(line, dict):
                continue
            role = str(line.get("role") or "")
            text = str(line.get("text") or "").strip()
            if role not in {"user", "assistant"} or not text:
                continue
            fresh.append({"role": role, "text": text[:500]})
        if fresh:
            await _file_call_log(session, signal, call, fresh)
    if fresh:
        from app.services.knowledge_lessons import schedule_call_lesson_after_commit

        schedule_call_lesson_after_commit(session, call.id)
    if already_ended:
        return call
    call.status = ENDED
    call.ended_at = utcnow()
    call.voice_client = ""
    call.voice_seen_at = None
    session.add(call)
    await session.flush()
    await publish_call(call)
    return call


async def start_voice_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    client_id: str = "",
    push_to_talk: bool = False,
) -> dict[str, Any]:
    """The person opened voice mode on a conversation. The line is live at once."""
    if not calls_enabled():
        raise status_error(status_code=409, detail="Calls are off in this workspace")
    signal = await session.get(Signal, signal_id)
    if signal is None or signal.tenant_id != tenant_id:
        raise NotFoundError("Conversation not found")
    await _lock_open_line(session, user_id)
    open_call = (
        await session.execute(
            select(AgentCall).where(
                AgentCall.tenant_id == tenant_id,
                AgentCall.user_id == user_id,
                AgentCall.status.in_(tuple(OPEN_STATUSES)),
            )
        )
    ).scalars().first()
    if open_call is not None:
        raise status_error(status_code=409, detail="Already on a call")
    agent = await session.get(Agent, signal.agent_id) if signal.agent_id else None
    if agent is None or agent.tenant_id != tenant_id:
        from app.services.agent_sessions import resolve_active_session

        hosted = await resolve_active_session(session, tenant_id, signal.id)
        if hosted is not None and hosted.agent_id:
            agent = await session.get(Agent, hosted.agent_id)
    if agent is None or agent.tenant_id != tenant_id:
        raise status_error(status_code=409, detail="This conversation has no agent")
    decision = (
        await session.execute(
            select(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.signal_id == signal.id,
                DecisionRequest.status == "awaiting_human",
            )
            .order_by(DecisionRequest.created_at.desc())
        )
    ).scalars().first()
    now = utcnow()
    call = AgentCall(
        tenant_id=tenant_id,
        signal_id=signal.id,
        agent_id=agent.id,
        decision_id=decision.id if decision is not None else None,
        run_id=decision.run_id if decision is not None else None,
        user_id=user_id,
        status=LIVE,
        ring_until=now,
        created_at=now,
        answered_at=now,
    )
    session.add(call)
    await session.flush()
    call = await _claim_voice(session, call, client_id)
    await _record_call(session, call, "voice")
    user = await session.get(User, user_id)
    prefs = _call_prefs(user, agent)
    voice_models = await _voice_models(session, agent)
    from app.services.agent_call_voice import create_realtime_secret

    title = decision.title if decision is not None else (signal.subject or "")
    summary = (decision.summary or "") if decision is not None else ""
    options = _options(decision) if decision is not None else []
    secret = await create_realtime_secret(
        await _call_instructions(
            session,
            call,
            agent_name=agent.name,
            title=title if decision is not None else "",
            summary=summary,
            options=options,
            language=prefs["language"],
            conversation=decision is None,
            push_to_talk=push_to_talk,
        ),
        language=prefs["language"],
        voice=prefs["voice"],
        speed=prefs["speed"],
        push_to_talk=push_to_talk,
        realtime_model=voice_models["realtime_model"],
        session=session,
        tenant_id=call.tenant_id,
    )
    await publish_call(
        call,
        agent_name=agent.name,
        title=title,
        summary=summary,
    )
    return {
        **serialize_call(
            call,
            agent_name=agent.name,
            title=title,
            summary=summary,
        ),
        "client_secret": secret["value"],
        "expires_at": secret.get("expires_at"),
        "model": secret.get("model") or voice_models["realtime_model"],
        **_public_prefs(prefs),
    }


async def accept_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
    client_id: str = "",
) -> dict[str, Any]:

    await _lock_open_line(session, user_id)
    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != RINGING:
        raise status_error(status_code=409, detail="Call is not ringing")
    if call.ring_until < utcnow():
        call.status = MISSED
        call.ended_at = utcnow()
        session.add(call)
        await session.flush()
        await publish_call(call)
        raise status_error(status_code=409, detail="Call was missed")
    if call.decision_id is None:
        raise status_error(status_code=409, detail="Decision is no longer open")
    decision = await session.get(DecisionRequest, call.decision_id)
    if decision is None or decision.status != "awaiting_human":
        call.status = ENDED
        call.ended_at = utcnow()
        session.add(call)
        await session.flush()
        raise status_error(status_code=409, detail="Decision is no longer open")
    agent = await session.get(Agent, call.agent_id) if call.agent_id else None
    user = await session.get(User, user_id)
    prefs = _call_prefs(user, agent)
    voice_models = await _voice_models(session, agent)
    from app.services.agent_call_voice import create_realtime_secret

    secret = await create_realtime_secret(
        await _call_instructions(
            session,
            call,
            agent_name=agent.name if agent else "the agent",
            title=decision.title,
            summary=decision.summary or "",
            options=_options(decision),
            language=prefs["language"],
        ),
        language=prefs["language"],
        voice=prefs["voice"],
        speed=prefs["speed"],
        realtime_model=voice_models["realtime_model"],
        session=session,
        tenant_id=call.tenant_id,
    )
    call.status = LIVE
    call.answered_at = utcnow()
    session.add(call)
    await session.flush()
    call = await _claim_voice(session, call, client_id)
    await _record_call(session, call, "answered")
    await publish_call(
        call,
        agent_name=agent.name if agent else "",
        title=decision.title,
        summary=decision.summary or "",
    )
    return {
        **serialize_call(
            call,
            agent_name=agent.name if agent else "",
            title=decision.title,
            summary=decision.summary or "",
        ),
        "client_secret": secret["value"],
        "expires_at": secret.get("expires_at"),
        "model": secret.get("model") or voice_models["realtime_model"],
        **_public_prefs(prefs),
    }


async def resume_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
    client_id: str = "",
) -> dict[str, Any]:
    """Mint a new voice secret for the tab that already holds the line.

    A reload of that same tab rejoins. Another tab does not, while the lease
    is fresh.
    """
    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != LIVE:
        raise status_error(status_code=409, detail="Call is not live")
    call = await _claim_voice(session, call, client_id)
    if call.status != LIVE:
        raise status_error(status_code=409, detail="Call is not live")
    decision = await session.get(DecisionRequest, call.decision_id) if call.decision_id else None
    agent = await session.get(Agent, call.agent_id) if call.agent_id else None
    user = await session.get(User, user_id)
    prefs = _call_prefs(user, agent)
    voice_models = await _voice_models(session, agent)
    title = decision.title if decision is not None else ""
    summary = (decision.summary or "") if decision is not None else ""
    options = _options(decision) if decision is not None and decision.status == "awaiting_human" else []
    from app.services.agent_call_voice import create_realtime_secret

    secret = await create_realtime_secret(
        await _call_instructions(
            session,
            call,
            agent_name=agent.name if agent else "the agent",
            title=title,
            summary=summary,
            options=options,
            reconnected=True,
            language=prefs["language"],
            conversation=not title.strip(),
        ),
        language=prefs["language"],
        voice=prefs["voice"],
        speed=prefs["speed"],
        realtime_model=voice_models["realtime_model"],
        session=session,
        tenant_id=call.tenant_id,
    )
    return {
        **serialize_call(
            call,
            agent_name=agent.name if agent else "",
            title=title,
            summary=summary,
        ),
        "client_secret": secret["value"],
        "expires_at": secret.get("expires_at"),
        "model": secret.get("model") or voice_models["realtime_model"],
        **_public_prefs(prefs),
    }


async def hold_voice_line(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
    client_id: str,
) -> None:
    """Refresh the lease for the tab that is actually on the call."""
    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != LIVE:
        raise status_error(status_code=409, detail="Call is not live")
    client = _call_client(client_id)
    if (call.voice_client or "") != client:
        raise status_error(status_code=409, detail="This call is already open in another tab")
    call.voice_seen_at = utcnow()
    session.add(call)
    await session.flush()


async def update_call_settings(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
    *,
    voice: str | None = None,
    speed: float | None = None,
    language: str | None = None,
    client_id: str = "",
    push_to_talk: bool = False,
) -> dict[str, Any]:
    """Save this person's voice, speed and spoken language for this agent.

    The agent's own default stays. Speed and language apply on the open
    session. The provider locks the voice after the first audio, so a new
    voice mints a fresh secret and the browser reconnects the same call.
    """
    from app.services.agent_call_voice import (
        VOICE_IDS,
        create_realtime_secret,
        match_speed,
        store_call_override,
    )

    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != LIVE:
        raise status_error(status_code=409, detail="Call is not live")
    if voice is not None and voice.strip().lower() not in VOICE_IDS:
        raise status_error(status_code=422, detail="Unknown voice")
    if language is not None and language.strip().lower() not in ("nl", "en"):
        raise status_error(status_code=422, detail="Unknown language")
    matched_speed = match_speed(speed) if speed is not None else None
    if speed is not None and matched_speed is None:
        raise status_error(status_code=422, detail="Unknown speed")
    agent = await session.get(Agent, call.agent_id) if call.agent_id else None
    user = await session.get(User, user_id)
    current = _call_prefs(user, agent)
    next_voice = voice.strip().lower() if voice is not None else current["voice"]
    next_speed = matched_speed if matched_speed is not None else current["speed"]
    next_language = language.strip().lower() if language is not None else current["language"]
    if user is not None and agent is not None:
        user.settings_json = store_call_override(
            user.settings_json,
            agent_id=agent.id,
            voice=next_voice,
            speed=next_speed,
            language=next_language,
        )
        session.add(user)
    decision = await session.get(DecisionRequest, call.decision_id) if call.decision_id else None
    title = decision.title if decision is not None else ""
    summary = (decision.summary or "") if decision is not None else ""
    options = _options(decision) if decision is not None and decision.status == "awaiting_human" else []
    instructions = await _call_instructions(
        session,
        call,
        agent_name=agent.name if agent else "the agent",
        title=title,
        summary=summary,
        options=options,
        reconnected=True,
        language=next_language,
        conversation=not title.strip(),
        push_to_talk=push_to_talk,
    )
    voice_changed = next_voice != current["voice"]
    payload: dict[str, Any] = {
        **_public_prefs({**current, "voice": next_voice, "speed": next_speed, "language": next_language}),
        "instructions": instructions,
        "reconnect": voice_changed,
    }
    if voice_changed:
        call = await _claim_voice(session, call, client_id)
        voice_models = await _voice_models(session, agent)
        secret = await create_realtime_secret(
            instructions,
            language=next_language,
            voice=next_voice,
            speed=next_speed,
            push_to_talk=push_to_talk,
            realtime_model=voice_models["realtime_model"],
            session=session,
            tenant_id=call.tenant_id,
        )
        payload["client_secret"] = secret["value"]
        payload["expires_at"] = secret.get("expires_at")
        payload["model"] = secret.get("model") or voice_models["realtime_model"]
    await session.flush()
    return payload
