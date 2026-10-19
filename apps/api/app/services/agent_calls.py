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

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
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
_REJECT_IDS = frozenset({"reject", "rejected", "deny", "denied", "no", "decline", "dismiss"})


def calls_enabled() -> bool:
    return bool(get_settings().agent_calls_enabled)


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
    return (
        visible_user_status(user, connected=str(user.id) in connected, now=now) == AVAILABLE
    )


async def _ring_user_id(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
) -> UUID | None:
    """The person who should hear the ring, or None when nobody is available."""
    now = datetime.utcnow()
    connected = connected_user_ids_for(tenant_id)
    if decision.addressee_kind == "user" and decision.addressee_user_id:
        user = await session.get(User, decision.addressee_user_id)
        if user is not None and _person_available(user, connected, now=now):
            return user.id
        return None
    if decision.addressee_kind == "department" and decision.addressee_department_id:
        from app.services.teams import get_team, team_members

        team = await get_team(session, tenant_id, decision.addressee_department_id)
        if team is None:
            return None
        for member in await team_members(session, team):
            if member.kind != "user":
                continue
            user = await session.get(User, member.id)
            if user is not None and _person_available(user, connected, now=now):
                return user.id
    return None


def serialize_call(
    call: AgentCall,
    *,
    agent_name: str = "",
    title: str = "",
    summary: str = "",
    text: str = "",
) -> dict[str, Any]:
    return {
        "call_id": str(call.id),
        "status": call.status,
        "user_id": str(call.user_id),
        "agent_id": str(call.agent_id) if call.agent_id else None,
        "agent_name": agent_name,
        "signal_id": str(call.signal_id),
        "decision_id": str(call.decision_id),
        "run_id": str(call.run_id) if call.run_id else None,
        "title": title,
        "summary": summary,
        "text": text,
        "ring_until": call.ring_until.isoformat() if call.ring_until else None,
    }


async def publish_call(
    call: AgentCall,
    *,
    agent_name: str = "",
    title: str = "",
    summary: str = "",
    text: str = "",
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
        ),
    )


async def maybe_ring_for_decision(
    session: AsyncSession,
    tenant_id: UUID,
    decision: DecisionRequest,
) -> AgentCall | None:
    """Start a ring after a turn reveals a card. Never removes the card."""
    if not calls_enabled():
        return None
    if decision.status != "awaiting_human" or decision.signal_id is None:
        return None
    if decision.message_id is None:
        return None
    existing = (
        await session.execute(
            select(AgentCall.id).where(
                AgentCall.tenant_id == tenant_id,
                AgentCall.decision_id == decision.id,
                AgentCall.status.in_(tuple(OPEN_STATUSES)),
            )
        )
    ).first()
    if existing is not None:
        return None
    user_id = await _ring_user_id(session, tenant_id, decision)
    if user_id is None:
        return None
    busy = (
        await session.execute(
            select(AgentCall.id).where(
                AgentCall.tenant_id == tenant_id,
                AgentCall.user_id == user_id,
                AgentCall.status.in_(tuple(OPEN_STATUSES)),
            )
        )
    ).first()
    if busy is not None:
        return None
    now = datetime.utcnow()
    call = AgentCall(
        tenant_id=tenant_id,
        signal_id=decision.signal_id,
        agent_id=None,
        decision_id=decision.id,
        run_id=decision.run_id,
        user_id=user_id,
        status=RINGING,
        ring_until=now + timedelta(seconds=ring_seconds()),
        created_at=now,
    )
    agent_name = ""
    from app.models.notification import Notification

    agent_id = None
    if decision.notification_id:
        note = await session.get(Notification, decision.notification_id)
        if note is not None:
            try:
                payload = json.loads(note.payload_json or "{}")
            except json.JSONDecodeError:
                payload = {}
            mark = payload.get("from") if isinstance(payload, dict) else None
            if isinstance(mark, dict) and mark.get("kind") == "agent" and mark.get("id"):
                try:
                    agent_id = UUID(str(mark["id"]))
                except ValueError:
                    agent_id = None
                agent_name = str(mark.get("name") or "")
    if agent_id is None:
        signal = await session.get(Signal, decision.signal_id)
        if signal is not None and signal.agent_id:
            agent_id = signal.agent_id
    if agent_id is not None:
        agent = await session.get(Agent, agent_id)
        if agent is not None and agent.tenant_id == tenant_id:
            call.agent_id = agent.id
            agent_name = agent_name or agent.name
    session.add(call)
    await session.flush()
    await publish_call(
        call,
        agent_name=agent_name,
        title=decision.title,
        summary=decision.summary or "",
    )
    return call


async def _load_owned(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
) -> AgentCall:
    from fastapi import HTTPException

    call = await session.get(AgentCall, call_id)
    if call is None or call.tenant_id != tenant_id or call.user_id != user_id:
        raise HTTPException(status_code=404, detail="Call not found")
    return call


async def decline_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
) -> AgentCall:
    from fastapi import HTTPException

    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != RINGING:
        raise HTTPException(status_code=409, detail="Call is not ringing")
    call.status = DECLINED
    call.ended_at = datetime.utcnow()
    session.add(call)
    await session.flush()
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
    call.ended_at = datetime.utcnow()
    session.add(call)
    await session.flush()
    await publish_call(call)
    return call


async def expire_rings(session: AsyncSession) -> int:
    """Mark rings that outlived their window. The decision card stays."""
    if not calls_enabled():
        return 0
    now = datetime.utcnow()
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
                AgentCall.status == RINGING,
                AgentCall.ring_until >= datetime.utcnow(),
            )
        )
    ).scalars().all()
    out: list[dict[str, Any]] = []
    for call in rows:
        decision = await session.get(DecisionRequest, call.decision_id)
        agent = await session.get(Agent, call.agent_id) if call.agent_id else None
        if decision is None or decision.status != "awaiting_human":
            continue
        out.append(
            serialize_call(
                call,
                agent_name=agent.name if agent else "",
                title=decision.title,
                summary=decision.summary or "",
            )
        )
    return out


def _schedule_consult(call_id: UUID, question: str) -> None:
    task = asyncio.create_task(_consult_run(call_id, question))

    def _done(done: asyncio.Task) -> None:
        if done.cancelled():
            return
        exc = done.exception()
        if exc is not None:
            logger.exception("agent call consult failed", exc_info=exc)

    task.add_done_callback(_done)


async def _consult_run(call_id: UUID, question: str) -> None:
    from app.db.session import async_session_factory
    from app.services.chat_runtime import post_message, start_agent_turn

    async with async_session_factory() as session:
        call = await session.get(AgentCall, call_id)
        if call is None or call.status != LIVE or call.agent_id is None:
            return
        agent = await session.get(Agent, call.agent_id)
        signal = await session.get(Signal, call.signal_id)
        if agent is None or signal is None:
            return
        decision = await session.get(DecisionRequest, call.decision_id)
        title = decision.title if decision else ""
        asked = question.strip()
        if not asked:
            return
        await post_message(
            session,
            signal,
            content=asked,
            role="user",
            trust="operator",
            author_user_id=call.user_id,
            metadata={"source": "agent_call", "agent_call_id": str(call.id)},
        )
        await session.commit()
        call = await session.get(AgentCall, call_id)
        if call is None or call.status != LIVE or call.agent_id is None:
            return
        agent = await session.get(Agent, call.agent_id)
        signal = await session.get(Signal, call.signal_id)
        if agent is None or signal is None:
            return
        result = await start_agent_turn(
            session,
            tenant_id=call.tenant_id,
            user_id=call.user_id,
            agent=agent,
            signal=signal,
            user_text=asked,
            trust="operator",
            surface="agent_call",
            extra_system=(
                "You are already on a live call with this person about: "
                f"{title}. Answer in one or two spoken sentences. "
                "Do not start a new question card unless you truly cannot proceed. "
                "The voice layer will read your reply aloud."
            ),
        )
        text = str(result.get("text") or "").strip()
        if text:
            await post_message(
                session,
                signal,
                content=text,
                role="assistant",
                trust="operator",
                author_agent_id=agent.id,
                metadata={"source": "agent_call", "agent_call_id": str(call.id)},
            )
        await session.commit()
        fresh = await session.get(AgentCall, call_id)
        if fresh is not None and fresh.status == LIVE and text:
            await publish_call(fresh, agent_name=agent.name, text=text, title=title)


async def run_call_tool(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
    *,
    name: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    from fastapi import HTTPException

    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != LIVE:
        raise HTTPException(status_code=409, detail="Call is not live")
    if name == "consult_run":
        question = str(arguments.get("question") or "").strip()
        if not question:
            raise HTTPException(status_code=400, detail="question is required")
        _schedule_consult(call.id, question)
        return {
            "status": "looking",
            "say": "Tell the person you are checking, then wait. A run update will arrive.",
        }
    if name == "confirm_choice":
        return await _confirm_choice(session, call, arguments)
    raise HTTPException(status_code=400, detail="Unknown call tool")


async def _confirm_choice(
    session: AsyncSession,
    call: AgentCall,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    from fastapi import HTTPException

    from app.services.signal_threads import resolve_message_decision

    decision = await session.get(DecisionRequest, call.decision_id)
    if decision is None or decision.signal_id is None or decision.message_id is None:
        raise HTTPException(status_code=404, detail="Decision not found")
    if decision.status != "awaiting_human":
        return {"status": "already_resolved", "decision_status": decision.status}
    option = match_option(
        _options(decision),
        option_id=str(arguments.get("option_id") or "") or None,
        label=str(arguments.get("label") or "") or None,
    )
    if option is None:
        raise HTTPException(status_code=400, detail="Option not found")
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


async def end_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
    *,
    transcript: list[dict[str, Any]] | None = None,
) -> AgentCall:
    from app.models.signal import SignalMessage
    from app.services.chat_runtime import post_message

    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status not in OPEN_STATUSES:
        return call
    signal = await session.get(Signal, call.signal_id)
    if signal is not None:
        recent = (
            await session.execute(
                select(SignalMessage.body_text).where(
                    SignalMessage.signal_id == signal.id,
                    SignalMessage.tenant_id == tenant_id,
                ).order_by(SignalMessage.created_at.desc()).limit(30)
            )
        ).scalars().all()
        seen = {str(body or "").strip() for body in recent}
        for line in (transcript or [])[:40]:
            if not isinstance(line, dict):
                continue
            role = str(line.get("role") or "")
            text = str(line.get("text") or "").strip()
            if role not in {"user", "assistant"} or not text or text in seen:
                continue
            seen.add(text)
            await post_message(
                session,
                signal,
                content=text,
                role=role,
                trust="operator",
                author_user_id=call.user_id if role == "user" else None,
                author_agent_id=call.agent_id if role == "assistant" else None,
                metadata={"source": "agent_call", "agent_call_id": str(call.id)},
            )
    call.status = ENDED
    call.ended_at = datetime.utcnow()
    session.add(call)
    await session.flush()
    await publish_call(call)
    return call


async def accept_call(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    call_id: UUID,
) -> dict[str, Any]:
    from fastapi import HTTPException

    call = await _load_owned(session, tenant_id, user_id, call_id)
    if call.status != RINGING:
        raise HTTPException(status_code=409, detail="Call is not ringing")
    if call.ring_until < datetime.utcnow():
        call.status = MISSED
        call.ended_at = datetime.utcnow()
        session.add(call)
        await session.flush()
        await publish_call(call)
        raise HTTPException(status_code=409, detail="Call was missed")
    decision = await session.get(DecisionRequest, call.decision_id)
    if decision is None or decision.status != "awaiting_human":
        call.status = ENDED
        call.ended_at = datetime.utcnow()
        session.add(call)
        await session.flush()
        raise HTTPException(status_code=409, detail="Decision is no longer open")
    agent = await session.get(Agent, call.agent_id) if call.agent_id else None
    from app.services.agent_call_voice import create_realtime_secret, voice_instructions

    secret = await create_realtime_secret(
        voice_instructions(
            agent_name=agent.name if agent else "the agent",
            title=decision.title,
            summary=decision.summary or "",
            options=_options(decision),
        )
    )
    call.status = LIVE
    call.answered_at = datetime.utcnow()
    session.add(call)
    await session.flush()
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
        "model": get_settings().openai_realtime_model,
        "voice": get_settings().openai_realtime_voice,
    }
