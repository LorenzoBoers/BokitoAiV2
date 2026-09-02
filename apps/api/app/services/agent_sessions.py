"""Inline agent sessions: an assistant conversation embedded in a thread.

A session is an assistant `Signal` (channel="assistant") whose
`context_signal_id` points at the host thread, plus a lifecycle
(`session_state` active -> closed). The existing chat endpoints handle the
actual conversation (streaming, tools, thread-transcript grounding); this
module owns start/close and the checkout outcome that stays visible in the
host thread's timeline as a collapsed, expandable block.
"""

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import User
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.signal_threads import _iso

# Tool calls that only read (research) are not "actions" worth surfacing in
# the checkout summary; everything else mutated state somewhere.
READ_ONLY_TOOLS = frozenset(
    {"search_index", "search_product_help", "list_docs", "read_doc", "get_tenant_overview"}
)

SUMMARY_MAX_CHARS = 400

# Checkout options the agent (or the idle nudge) can put on the card.
# `end_only` and `continue` are always present so the operator can never be
# cornered into applying something to leave the session.
CHECKOUT_KINDS = ("end_only", "continue", "apply_actions")
CHECKOUT_ACTION_TYPE = "session_checkout"
DEFAULT_CHECKOUT_LABELS = {
    "end_only": "End session",
    "continue": "Keep going",
    "apply_actions": "Apply and end",
}


def _load_outcome(signal: Signal) -> dict[str, Any]:
    try:
        outcome = json.loads(signal.session_outcome_json or "{}")
    except json.JSONDecodeError:
        return {}
    return outcome if isinstance(outcome, dict) else {}


def serialize_session(
    signal: Signal, agent: Agent | None, *, message_count: int | None = None
) -> dict[str, Any]:
    outcome = _load_outcome(signal)
    return {
        "id": str(signal.id),
        "thread_id": str(signal.context_signal_id) if signal.context_signal_id else None,
        "state": signal.session_state,
        "agent_id": str(signal.agent_id) if signal.agent_id else None,
        "agent_name": agent.name if agent else None,
        "owner_user_id": str(signal.owner_user_id) if signal.owner_user_id else None,
        "started_at": _iso(signal.created_at),
        "closed_at": _iso(signal.session_closed_at) if signal.session_closed_at else None,
        "summary": outcome.get("summary") or "",
        "actions": outcome.get("actions") or [],
        "checkout_decision_id": outcome.get("checkout_decision_id"),
        "message_count": (
            message_count if message_count is not None else outcome.get("message_count") or 0
        ),
    }


async def _chat_message_count(session: AsyncSession, conversation_id: UUID) -> int:
    """Turns exchanged so far — an active session only counts once it has one."""
    result = await session.execute(
        select(func.count())
        .select_from(SignalMessage)
        .where(
            SignalMessage.signal_id == conversation_id,
            SignalMessage.kind.in_(("user_message", "agent_message")),
        )
    )
    return int(result.scalar() or 0)


async def _load_host_thread(session: AsyncSession, tenant_id: UUID, thread_id: UUID) -> Signal:
    result = await session.execute(
        select(Signal).where(Signal.id == thread_id, Signal.tenant_id == tenant_id)
    )
    thread = result.scalar_one_or_none()
    if thread is None:
        raise HTTPException(status_code=404, detail="Thread not found")
    if thread.channel == "assistant":
        raise HTTPException(
            status_code=400, detail="Cannot start an agent session inside an assistant chat"
        )
    return thread


async def list_sessions(
    session: AsyncSession, tenant_id: UUID, thread_id: UUID
) -> list[dict[str, Any]]:
    """All sessions on a thread, oldest first (team-visible by design)."""
    result = await session.execute(
        select(Signal)
        .where(
            Signal.tenant_id == tenant_id,
            Signal.context_signal_id == thread_id,
            Signal.channel == "assistant",
            Signal.session_state.is_not(None),
        )
        .order_by(Signal.created_at)
    )
    signals = list(result.scalars().all())
    agent_ids = {s.agent_id for s in signals if s.agent_id}
    agents: dict[UUID, Agent] = {}
    if agent_ids:
        agents_result = await session.execute(
            select(Agent).where(Agent.id.in_(agent_ids), Agent.tenant_id == tenant_id)
        )
        agents = {a.id: a for a in agents_result.scalars().all()}
    rows: list[dict[str, Any]] = []
    for s in signals:
        # Active sessions report their live turn count: the UI offers "cancel"
        # until the first turn and "finish" afterwards.
        live = await _chat_message_count(session, s.id) if s.session_state == "active" else None
        rows.append(
            serialize_session(
                s, agents.get(s.agent_id) if s.agent_id else None, message_count=live
            )
        )
    return rows


async def start_session(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    thread_id: UUID,
    agent: Agent,
) -> dict[str, Any]:
    """Open a session; reuses the caller's existing active session on the thread.

    One meta per thread: any other operator's session still open on this
    conversation checks out first, so the timeline never carries two live
    sessions competing over the same customer.
    """
    thread = await _load_host_thread(session, tenant_id, thread_id)

    active = list(
        (
            await session.execute(
                select(Signal).where(
                    Signal.tenant_id == tenant_id,
                    Signal.context_signal_id == thread_id,
                    Signal.channel == "assistant",
                    Signal.session_state == "active",
                )
            )
        ).scalars().all()
    )
    existing = next((s for s in active if s.owner_user_id == user.id), None)
    for other in active:
        if existing is not None and other.id == existing.id:
            continue
        await close_session(session, tenant_id, user.id, thread_id, other.id)
    if existing is not None:
        return serialize_session(existing, agent if existing.agent_id == agent.id else None)

    conversation = Signal(
        tenant_id=tenant_id,
        channel="assistant",
        source="agent_session",
        subject=f"Agent session: {thread.subject[:80]}",
        owner_user_id=user.id,
        agent_id=agent.id,
        contact_name=user.display_name or user.email,
        has_unread=False,
        context_signal_id=thread_id,
        session_state="active",
    )
    session.add(conversation)
    await session.flush()
    session.add(
        SignalEvent(
            signal_id=thread_id,
            tenant_id=tenant_id,
            event_type="agent_session_started",
            actor_type="user",
            actor_id=str(user.id),
            payload_json=json.dumps(
                {"session_id": str(conversation.id), "agent_id": str(agent.id), "agent_name": agent.name}
            ),
        )
    )
    await session.commit()
    await session.refresh(conversation)
    return serialize_session(conversation, agent)


async def thread_agent_candidates(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    thread_id: UUID,
    *,
    is_admin: bool = False,
) -> list[dict[str, Any]]:
    """Agents the operator can bring into this thread, most relevant first.

    Relevance follows the platform's own routing model: the agent bound to
    this channel/account/contact handles the conversation, the project lead
    owns its work, and every other permitted agent is a specialist the
    operator may call in. `reason` drives the label in the picker.
    """
    from app.services.personal_agents import allowed_company_agents
    from app.services.routing import resolve_agent_for_signal

    thread = await _load_host_thread(session, tenant_id, thread_id)

    ranked: list[dict[str, Any]] = []
    seen: set[UUID] = set()

    def add(agent: Agent | None, reason: str) -> None:
        if agent is None or agent.id in seen or not agent.is_active:
            return
        seen.add(agent.id)
        ranked.append({"id": str(agent.id), "name": agent.name, "reason": reason})

    add(await resolve_agent_for_signal(session, thread), "channel")

    if thread.project_id:
        from app.models.project import Project

        project = (
            await session.execute(
                select(Project).where(
                    Project.id == thread.project_id, Project.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if project and project.po_agent_id:
            lead = (
                await session.execute(
                    select(Agent).where(
                        Agent.id == project.po_agent_id, Agent.tenant_id == tenant_id
                    )
                )
            ).scalar_one_or_none()
            add(lead, "project")

    for agent in await allowed_company_agents(session, tenant_id, user.id, is_admin=is_admin):
        add(agent, "company")

    return ranked


async def resolve_session_agent(
    session: AsyncSession,
    tenant_id: UUID,
    user: User,
    thread_id: UUID,
    agent_id: UUID | None,
    *,
    is_admin: bool = False,
) -> Agent:
    """The agent to bring in: an explicit candidate, else the most relevant one.

    Wider than plain chat targets on purpose: the agent that handles this
    channel may not be open for direct chat, yet it is exactly the one an
    operator wants next to a conversation it owns.
    """
    candidates = await thread_agent_candidates(
        session, tenant_id, user, thread_id, is_admin=is_admin
    )
    if not candidates:
        raise HTTPException(status_code=409, detail="No agent available for this workspace")

    wanted = str(agent_id) if agent_id else candidates[0]["id"]
    if wanted not in {c["id"] for c in candidates}:
        raise HTTPException(status_code=403, detail="Agent not available on this thread")

    agent = (
        await session.execute(
            select(Agent).where(Agent.id == UUID(wanted), Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


async def discard_session(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    thread_id: UUID,
    session_id: UUID,
) -> dict[str, Any]:
    """Cancel a session that never started: remove it instead of checking out.

    A session only becomes history once a turn was exchanged. Cancelling
    before that deletes the conversation and its "started" event so the host
    thread keeps a clean timeline. If turns did arrive (the operator sent one
    while cancelling), it checks out normally instead.
    """
    conversation = await _load_session(session, tenant_id, thread_id, session_id)

    if conversation.session_state == "active" and await _chat_message_count(
        session, conversation.id
    ):
        closed = await close_session(session, tenant_id, user_id, thread_id, session_id)
        return {"discarded": False, "session": closed}

    started_events = (
        await session.execute(
            select(SignalEvent).where(
                SignalEvent.signal_id == thread_id,
                SignalEvent.tenant_id == tenant_id,
                SignalEvent.event_type == "agent_session_started",
            )
        )
    ).scalars().all()
    for event in started_events:
        try:
            payload = json.loads(event.payload_json or "{}")
        except json.JSONDecodeError:
            continue
        if payload.get("session_id") == str(conversation.id):
            await session.delete(event)

    from app.services.signal_threads import delete_thread

    await delete_thread(session, tenant_id, conversation.id, user_id=user_id)
    return {"discarded": True, "session_id": str(conversation.id)}


def _extract_actions(messages: list[SignalMessage]) -> list[dict[str, Any]]:
    """Consequential tool calls from the agent messages' trace steps."""
    actions: list[dict[str, Any]] = []
    for msg in messages:
        if msg.kind != "agent_message":
            continue
        try:
            meta = json.loads(msg.metadata_json or "{}")
        except json.JSONDecodeError:
            continue
        for step in meta.get("steps") or []:
            if step.get("step_type") != "tool_call":
                continue
            name = step.get("name") or ""
            if not name or name in READ_ONLY_TOOLS:
                continue
            payload = step.get("payload") or {}
            detail = ""
            raw_input = payload.get("input")
            if isinstance(raw_input, dict):
                # MCP calls carry the real tool name inside the input.
                detail = str(raw_input.get("tool") or raw_input.get("name") or "")
            actions.append({"tool": name, "detail": detail, "at": _iso(msg.created_at)})
    return actions


async def _load_session(
    session: AsyncSession, tenant_id: UUID, thread_id: UUID, session_id: UUID
) -> Signal:
    conversation = (
        await session.execute(
            select(Signal).where(
                Signal.id == session_id,
                Signal.tenant_id == tenant_id,
                Signal.channel == "assistant",
                Signal.context_signal_id == thread_id,
                Signal.session_state.is_not(None),
            )
        )
    ).scalar_one_or_none()
    if conversation is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return conversation


async def close_session(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    thread_id: UUID,
    session_id: UUID,
    *,
    summary: str | None = None,
) -> dict[str, Any]:
    """Checkout: freeze the session and write its outcome to the host thread.

    `summary` overrides the derived one — the agent's own checkout wording
    beats the raw tail of its last message.
    """
    conversation = await _load_session(session, tenant_id, thread_id, session_id)

    agent = None
    if conversation.agent_id:
        agent = (
            await session.execute(
                select(Agent).where(
                    Agent.id == conversation.agent_id, Agent.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()

    if conversation.session_state == "closed":
        return serialize_session(conversation, agent)

    messages = list(
        (
            await session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == conversation.id,
                    SignalMessage.tenant_id == tenant_id,
                )
                .order_by(SignalMessage.created_at)
            )
        ).scalars().all()
    )
    chat_messages = [m for m in messages if m.kind in ("user_message", "agent_message")]
    last_agent_text = next(
        (m.body_text for m in reversed(chat_messages) if m.kind == "agent_message" and m.body_text),
        "",
    )
    resolved_summary = (summary or last_agent_text).strip()[:SUMMARY_MAX_CHARS]
    actions = _extract_actions(messages)

    outcome = {
        "summary": resolved_summary,
        "actions": actions,
        "message_count": len(chat_messages),
    }
    conversation.session_state = "closed"
    conversation.session_closed_at = datetime.utcnow()
    conversation.session_outcome_json = json.dumps(outcome)
    conversation.updated_at = datetime.utcnow()
    session.add(conversation)
    session.add(
        SignalEvent(
            signal_id=thread_id,
            tenant_id=tenant_id,
            event_type="agent_session_closed",
            actor_type="user" if user_id else "system",
            actor_id=str(user_id or ""),
            payload_json=json.dumps({"session_id": str(conversation.id), **outcome}),
        )
    )
    await session.commit()
    await session.refresh(conversation)
    return serialize_session(conversation, agent)


# ── checkout proposal ────────────────────────────────────────────


async def resolve_active_session(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    agent_id: UUID | None = None,
) -> Signal | None:
    """The active session a tool call belongs to, from either end of the pair.

    Tools inside a session act on the host thread, so the signal a tool sees
    is normally the host; the session is the assistant conversation pointing
    at it. Accept both so the lookup works from the loop and from tests.
    """
    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if signal is None:
        return None
    if signal.channel == "assistant" and signal.session_state == "active":
        return signal

    candidates = list(
        (
            await session.execute(
                select(Signal)
                .where(
                    Signal.tenant_id == tenant_id,
                    Signal.context_signal_id == signal.id,
                    Signal.channel == "assistant",
                    Signal.session_state == "active",
                )
                .order_by(Signal.created_at.desc())
            )
        ).scalars().all()
    )
    if not candidates:
        return None
    if agent_id:
        owned = next((c for c in candidates if c.agent_id == agent_id), None)
        if owned is not None:
            return owned
    return candidates[0]


def _checkout_option(
    option_id: str, label: str, kind: str, *, session_id: UUID, thread_id: UUID
) -> dict[str, Any]:
    return {
        "id": option_id,
        "label": label,
        "action_type": CHECKOUT_ACTION_TYPE,
        "payload": {
            "session_checkout": True,
            "kind": kind,
            "session_id": str(session_id),
            "thread_id": str(thread_id),
        },
    }


def _checkout_options(
    raw: Any, *, session_id: UUID, thread_id: UUID
) -> list[dict[str, Any]]:
    """Normalize agent-supplied options and guarantee end / continue exist."""
    from app.services.agent.style import strip_emoji

    options: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_kinds: set[str] = set()
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        if kind not in CHECKOUT_KINDS:
            continue
        option_id = str(item.get("id") or kind).strip() or kind
        if option_id in seen_ids:
            continue
        label = strip_emoji(str(item.get("label") or "")).strip()
        seen_ids.add(option_id)
        seen_kinds.add(kind)
        options.append(
            _checkout_option(
                option_id,
                label or DEFAULT_CHECKOUT_LABELS[kind],
                kind,
                session_id=session_id,
                thread_id=thread_id,
            )
        )
    for kind in ("end_only", "continue"):
        if kind in seen_kinds:
            continue
        option_id = kind if kind not in seen_ids else f"session_{kind}"
        seen_ids.add(option_id)
        options.append(
            _checkout_option(
                option_id,
                DEFAULT_CHECKOUT_LABELS[kind],
                kind,
                session_id=session_id,
                thread_id=thread_id,
            )
        )
    return options


async def _supersede_checkout(
    session: AsyncSession, tenant_id: UUID, decision_id: str | None
) -> None:
    """A newer checkout replaces the pending one instead of stacking cards."""
    if not decision_id:
        return
    try:
        stale_id = UUID(str(decision_id))
    except ValueError:
        return
    stale = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id == stale_id,
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "awaiting_human",
            )
        )
    ).scalar_one_or_none()
    if stale is None:
        return
    stale.status = "deferred"
    stale.resolved_at = datetime.utcnow()
    stale.chosen_option_id = "superseded"
    session.add(stale)
    if stale.notification_id:
        notification = (
            await session.execute(
                select(Notification).where(Notification.id == stale.notification_id)
            )
        ).scalar_one_or_none()
        if notification and notification.status == "unread":
            notification.status = "read"
            session.add(notification)


async def propose_checkout(
    session: AsyncSession,
    tenant_id: UUID,
    conversation: Signal,
    *,
    summary: str,
    options: Any = None,
    user_id: UUID | None = None,
    origin: str = "agent",
) -> dict[str, Any]:
    """Offer the operator a checkout on the host thread; keep the session open.

    The session only ends once the operator picks: the card is a proposal,
    not the checkout itself, so an agent can never close a meta unilaterally.
    """
    from app.services.signal_decisions import create_decision

    if conversation.session_state != "active":
        return {"error": "Session is not active"}
    thread_id = conversation.context_signal_id or conversation.id

    agent = None
    if conversation.agent_id:
        agent = (
            await session.execute(
                select(Agent).where(
                    Agent.id == conversation.agent_id, Agent.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()

    outcome = _load_outcome(conversation)
    await _supersede_checkout(session, tenant_id, outcome.get("checkout_decision_id"))

    decision, _ = await create_decision(
        session,
        tenant_id,
        title=f"Session checkout: {agent.name}" if agent else "Session checkout",
        summary=summary,
        options=_checkout_options(options, session_id=conversation.id, thread_id=thread_id),
        user_id=conversation.owner_user_id or user_id,
        agent_id=conversation.agent_id,
        signal_id=thread_id,
        source_type="agent_session",
        source_id=str(conversation.id),
        notification_payload={
            "session_checkout": True,
            "session_id": str(conversation.id),
            "thread_id": str(thread_id),
            "origin": origin,
        },
    )

    outcome.update({"checkout_decision_id": str(decision.id), "checkout_summary": summary})
    if origin == "idle":
        outcome["idle_nudge_at"] = _iso(datetime.utcnow())
    conversation.session_outcome_json = json.dumps(outcome)
    conversation.updated_at = datetime.utcnow()
    session.add(conversation)
    await session.commit()
    return {
        "ok": True,
        "decision_request_id": str(decision.id),
        "session_id": str(conversation.id),
        "thread_id": str(thread_id),
        "status": "awaiting_human",
        "note": (
            "The checkout is waiting on the conversation. The teammate ends or "
            "continues the session from that card; nothing closed yet."
        ),
    }


async def apply_checkout_choice(
    session: AsyncSession,
    tenant_id: UUID,
    payload: dict[str, Any],
    *,
    user_id: UUID | None = None,
) -> dict[str, Any]:
    """Execute a resolved checkout option: end the session, or keep it open."""
    kind = str(payload.get("kind") or "end_only")
    raw_session_id = payload.get("session_id")
    if not raw_session_id:
        return {"ok": False, "error": "session_id missing"}
    try:
        session_id = UUID(str(raw_session_id))
    except ValueError:
        return {"ok": False, "error": "session_id invalid"}

    conversation = (
        await session.execute(
            select(Signal).where(
                Signal.id == session_id,
                Signal.tenant_id == tenant_id,
                Signal.channel == "assistant",
                Signal.session_state.is_not(None),
            )
        )
    ).scalar_one_or_none()
    if conversation is None:
        return {"ok": False, "error": "Session not found"}

    outcome = _load_outcome(conversation)
    if kind == "continue":
        # Back to work: drop the pending checkout so the agent (or the idle
        # nudge) may offer a fresh one later.
        outcome.pop("checkout_decision_id", None)
        outcome.pop("checkout_summary", None)
        outcome.pop("idle_nudge_at", None)
        conversation.session_outcome_json = json.dumps(outcome)
        conversation.updated_at = datetime.utcnow()
        session.add(conversation)
        return {"ok": True, "state": "active", "session_id": str(conversation.id)}

    if conversation.session_state == "closed":
        return {"ok": True, "state": "closed", "session_id": str(conversation.id)}

    thread_id = conversation.context_signal_id or conversation.id
    closed = await close_session(
        session,
        tenant_id,
        user_id,
        thread_id,
        conversation.id,
        summary=str(outcome.get("checkout_summary") or "") or None,
    )
    return {"ok": True, "state": closed.get("state"), "session_id": str(conversation.id)}


async def _idle_summary(session: AsyncSession, conversation: Signal) -> str:
    last_agent_text = (
        await session.execute(
            select(SignalMessage.body_text)
            .where(
                SignalMessage.signal_id == conversation.id,
                SignalMessage.kind == "agent_message",
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar()
    tail = (last_agent_text or "").strip()[:SUMMARY_MAX_CHARS]
    opening = "This session has been idle for a while."
    return f"{opening} Last from the agent: {tail}" if tail else opening


async def nudge_idle_sessions(
    session: AsyncSession,
    *,
    idle_seconds: int | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Offer a checkout on sessions the operator walked away from.

    One nudge per session (`idle_nudge_at`): an unanswered card is not a
    reason to keep asking, and a resolved "keep going" clears the marker.
    """
    from app.config import get_settings

    idle = int(
        idle_seconds if idle_seconds is not None else get_settings().session_idle_seconds
    )
    if idle <= 0:
        return {"checked": 0, "nudged": 0}
    cutoff = datetime.utcnow() - timedelta(seconds=idle)

    candidates = list(
        (
            await session.execute(
                select(Signal)
                .where(
                    Signal.channel == "assistant",
                    Signal.source == "agent_session",
                    Signal.session_state == "active",
                    Signal.context_signal_id.is_not(None),
                    Signal.updated_at <= cutoff,
                )
                .order_by(Signal.updated_at)
                .limit(500)
            )
        ).scalars().all()
    )

    nudged = 0
    for conversation in candidates:
        if nudged >= limit:
            break
        outcome = _load_outcome(conversation)
        if outcome.get("idle_nudge_at") or outcome.get("checkout_decision_id"):
            continue
        last_user_at = (
            await session.execute(
                select(func.max(SignalMessage.created_at)).where(
                    SignalMessage.signal_id == conversation.id,
                    SignalMessage.kind == "user_message",
                )
            )
        ).scalar()
        # A session without a single turn is a cancel, not a checkout.
        if last_user_at is None or last_user_at > cutoff:
            continue
        result = await propose_checkout(
            session,
            conversation.tenant_id,
            conversation,
            summary=await _idle_summary(session, conversation),
            origin="idle",
        )
        if result.get("ok"):
            nudged += 1
    return {"checked": len(candidates), "nudged": nudged}
