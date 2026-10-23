"""Inline agent sessions: an assistant conversation embedded in a thread.

A session is an assistant `Signal` (channel="assistant") whose
`context_signal_id` points at the host thread, plus a lifecycle
(`session_state` active -> closed). The existing chat endpoints handle the
actual conversation (streaming, tools, thread-transcript grounding); this
module owns start/close and the checkout outcome that stays visible in the
host thread's timeline as a collapsed, expandable block.
"""

import json
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.exceptions import ForbiddenError, NotFoundError, status_error
from app.models.agent import Agent
from app.models.auth import User
from app.models.notification import DecisionRequest, Notification
from app.models.signal import Signal, SignalEvent, SignalMessage, is_internal_channel
from app.services.signal_threads import _iso
from app.services.trash import alive

# Tool calls that only read (research) are not "actions" worth surfacing in
# the checkout summary; everything else mutated state somewhere.
READ_ONLY_TOOLS = frozenset(
    {"search_index", "search_product_help", "list_docs", "read_doc", "get_tenant_overview"}
)

SUMMARY_MAX_CHARS = 400

# Idle-close copy per workspace language. Leftover wrap-up cards still
# resolve through apply_checkout_choice; new sessions never create one.
CHECKOUT_COPY: dict[str, dict[str, str]] = {
    "en": {
        "end_only": "End session",
        "continue": "Keep going",
        "apply_actions": "Apply and end",
        "title": "Wrap up session with {agent}",
        "title_plain": "Wrap up session",
        "idle_opening": "This session has been quiet for a while.",
        "idle_last": "Last from the agent: {tail}",
    },
    "nl": {
        "end_only": "Sessie afronden",
        "continue": "Doorgaan",
        "apply_actions": "Toepassen en afronden",
        "title": "Sessie met {agent} afronden?",
        "title_plain": "Sessie afronden?",
        "idle_opening": "Deze sessie staat al een tijd stil.",
        "idle_last": "Laatste van de agent: {tail}",
    },
}


def _checkout_copy(lang: str) -> dict[str, str]:
    return CHECKOUT_COPY.get(lang, CHECKOUT_COPY["en"])


async def _workspace_lang(session: AsyncSession, tenant_id: UUID) -> str:
    from app.models.auth import Tenant
    from app.services.language import resolve_workspace_language

    tenant = await session.get(Tenant, tenant_id)
    lang = resolve_workspace_language(tenant)
    return lang if lang in CHECKOUT_COPY else "en"


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
        select(Signal).where(
            Signal.id == thread_id, Signal.tenant_id == tenant_id, alive(Signal)
        )
    )
    thread = result.scalar_one_or_none()
    if thread is None:
        raise NotFoundError("Thread not found")
    if is_internal_channel(thread.channel):
        raise status_error(
            status_code=400,
            detail="Agent sessions only apply to conversations with people outside the workspace",
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
            alive(Signal),
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
    """Open a session; reuses the caller's active session only when it is the same agent.

    One meta per thread: any other operator's session still open on this
    conversation checks out first, so the timeline never carries two live
    sessions competing over the same customer. A leftover session for a
    different agent is discarded (or checked out if it already has turns).
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
                    alive(Signal),
                )
            )
        ).scalars().all()
    )
    existing = next((s for s in active if s.owner_user_id == user.id), None)
    if existing is not None and existing.agent_id != agent.id:
        leftover_id = existing.id
        # Asking a different agent must not keep talking to the leftover one.
        await discard_session(session, tenant_id, user.id, thread_id, leftover_id)
        existing = None
        active = [s for s in active if s.id != leftover_id]
    for other in active:
        if existing is not None and other.id == existing.id:
            continue
        await close_session(session, tenant_id, user.id, thread_id, other.id)
    if existing is not None:
        live = await _chat_message_count(session, existing.id)
        return serialize_session(existing, agent, message_count=live)

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
    from app.services.ownership import apply_owner
    from app.services.participants import ensure_participant

    session.add(conversation)
    await session.flush()
    await apply_owner(session, conversation, "user", user.id, by_user_id=user.id)
    # Host thread + Ask session share the same participant roster model.
    await ensure_participant(
        session,
        thread,
        kind="agent",
        ref_id=agent.id,
        role="member",
        invited_by_kind="user",
        invited_by_id=user.id,
        joined_via="ask_session",
    )
    await ensure_participant(
        session,
        conversation,
        kind="agent",
        ref_id=agent.id,
        role="member",
        invited_by_kind="user",
        invited_by_id=user.id,
        joined_via="ask_session",
    )
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
        if project:
            from app.services.lead_agent import get_lead_agent

            add(await get_lead_agent(session, tenant_id), "project")

    # Module specialists for installed modules (and ticket/folder-related work).
    from app.services.module_agents import module_roster_summaries

    roster = await module_roster_summaries(session, tenant_id)
    for slug, summary in roster.items():
        sid = summary.get("specialist_agent_id")
        if not sid:
            continue
        specialist = (
            await session.execute(
                select(Agent).where(Agent.id == UUID(sid), Agent.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        add(specialist, f"module:{slug}")

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

    Threads can still point at an archived/inactive agent after a purge. In
    that case fall back to the best live candidate so Ask does not 403 with
    a generic "could not start session" toast.
    """
    candidates = await thread_agent_candidates(
        session, tenant_id, user, thread_id, is_admin=is_admin
    )
    if not candidates:
        raise status_error(status_code=409, detail="No agent available for this workspace")

    candidate_ids = {c["id"] for c in candidates}
    wanted = str(agent_id) if agent_id else candidates[0]["id"]
    if wanted not in candidate_ids:
        if agent_id is not None:
            stale = (
                await session.execute(
                    select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            # Archived / inactive / missing: remount onto the best candidate.
            # An active agent the operator may not call stays a hard 403.
            if stale is None or not stale.is_active:
                wanted = candidates[0]["id"]
            else:
                raise ForbiddenError("Agent not available on this thread")
        else:
            wanted = candidates[0]["id"]

    agent = (
        await session.execute(
            select(Agent).where(Agent.id == UUID(wanted), Agent.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if agent is None:
        raise NotFoundError("Agent not found")
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
    conversation = await _load_session(
        session, tenant_id, thread_id, session_id, include_deleted=True
    )

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

    # Empty sessions never started; hard-delete so they do not linger in the
    # host timeline or the Bin after the operator presses Cancel.
    await delete_thread(
        session, tenant_id, conversation.id, user_id=user_id, permanent=True
    )
    return {"discarded": True, "session_id": str(conversation.id)}


def _extract_actions(messages: list[SignalMessage]) -> list[dict[str, Any]]:
    """Consequential tool calls from the agent messages' activity."""
    from app.services.agent.turn_persist import message_activity

    actions: list[dict[str, Any]] = []
    for msg in messages:
        if msg.kind != "agent_message":
            continue
        try:
            meta = json.loads(msg.metadata_json or "{}")
        except json.JSONDecodeError:
            continue
        shaped = message_activity(meta, detail=True)
        for item in [*shaped["activity"], *shaped["activity_after"]]:
            name = item.get("tool") or ""
            if not name or name in READ_ONLY_TOOLS:
                continue
            detail = ""
            raw_input = item.get("input")
            if isinstance(raw_input, dict):
                # MCP calls carry the real tool name inside the input.
                detail = str(raw_input.get("tool") or raw_input.get("name") or "")
            actions.append({"tool": name, "detail": detail, "at": _iso(msg.created_at)})
    return actions


async def _load_session(
    session: AsyncSession,
    tenant_id: UUID,
    thread_id: UUID,
    session_id: UUID,
    *,
    include_deleted: bool = False,
) -> Signal:
    filters = [
        Signal.id == session_id,
        Signal.tenant_id == tenant_id,
        Signal.channel == "assistant",
        Signal.context_signal_id == thread_id,
        Signal.session_state.is_not(None),
    ]
    if not include_deleted:
        filters.append(alive(Signal))
    conversation = (
        await session.execute(select(Signal).where(*filters))
    ).scalar_one_or_none()
    if conversation is None:
        raise NotFoundError("Session not found")
    return conversation


async def close_open_sessions_for_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    thread_id: UUID,
    *,
    summary: str | None = None,
) -> int:
    """Close every active in-thread agent session (e.g. after human takeover)."""
    active = list(
        (
            await session.execute(
                select(Signal).where(
                    Signal.tenant_id == tenant_id,
                    Signal.context_signal_id == thread_id,
                    Signal.channel == "assistant",
                    Signal.session_state == "active",
                    alive(Signal),
                )
            )
        ).scalars().all()
    )
    closed = 0
    for row in active:
        await close_session(
            session, tenant_id, user_id, thread_id, row.id, summary=summary
        )
        closed += 1
    return closed


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

    pending = _load_outcome(conversation)
    await _supersede_session_checkouts(session, tenant_id, conversation.id)
    await _supersede_checkout(session, tenant_id, pending.get("checkout_decision_id"))

    outcome = {
        "summary": resolved_summary,
        "actions": actions,
        "message_count": len(chat_messages),
    }
    conversation.session_state = "closed"
    conversation.session_closed_at = utcnow()
    conversation.session_outcome_json = json.dumps(outcome)
    conversation.updated_at = utcnow()
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
                    alive(Signal),
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


async def _supersede_session_checkouts(
    session: AsyncSession, tenant_id: UUID, conversation_id: UUID
) -> None:
    """Withdraw leftover wrap-up cards for this session (no longer asked)."""
    stale_rows = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.source_type == "agent_session",
                DecisionRequest.source_id == str(conversation_id),
                DecisionRequest.status == "awaiting_human",
            )
        )
    ).scalars().all()
    for stale in stale_rows:
        await _supersede_checkout(session, tenant_id, str(stale.id))


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
    stale.resolved_at = utcnow()
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
    """Close the inline session. No wrap-up card — the collapsed marker is enough."""
    del options  # leftover tool schema; closing is automatic
    if conversation.session_state != "active":
        return {"error": "Session is not active"}
    thread_id = conversation.context_signal_id or conversation.id
    closed = await close_session(
        session,
        tenant_id,
        user_id or conversation.owner_user_id,
        thread_id,
        conversation.id,
        summary=summary,
    )
    return {
        "ok": True,
        "session_id": str(conversation.id),
        "thread_id": str(thread_id),
        "status": "closed",
        "state": closed.get("state"),
        "origin": origin,
        "note": "The session closed. The teammate sees the collapsed summary on the conversation.",
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
                alive(Signal),
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
        conversation.updated_at = utcnow()
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


async def resume_session_after_message(
    session: AsyncSession, tenant_id: UUID, conversation: Signal
) -> bool:
    """The operator kept talking: a pending checkout card is moot.

    Same effect as picking "Keep going", applied implicitly so the card does
    not linger above a session that is clearly still in use. Returns True when
    a card was withdrawn. Does not commit.
    """
    if conversation.session_state != "active":
        return False
    outcome = _load_outcome(conversation)
    decision_id = outcome.get("checkout_decision_id")
    if not decision_id:
        return False
    await _supersede_checkout(session, tenant_id, decision_id)
    outcome.pop("checkout_decision_id", None)
    outcome.pop("checkout_summary", None)
    outcome.pop("idle_nudge_at", None)
    conversation.session_outcome_json = json.dumps(outcome)
    conversation.updated_at = utcnow()
    session.add(conversation)
    return True


_ERROR_TAIL_MARKERS = (
    "encountered an error while generating a reply",
    "cannot reply because no llm api key",
    "took too long to start a reply",
    "ai provider is busy right now",
    "daily llm token budget exhausted",
)


def _is_error_agent_tail(body: str | None, metadata_json: str | None) -> bool:
    """True when the last bubble is a system failure, not a real agent reply."""
    try:
        meta = json.loads(metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    if isinstance(meta, dict) and meta.get("error"):
        return True
    text = (body or "").strip().lower()
    return any(marker in text for marker in _ERROR_TAIL_MARKERS)


async def _idle_summary(session: AsyncSession, conversation: Signal) -> str:
    copy = _checkout_copy(await _workspace_lang(session, conversation.tenant_id))
    rows = list(
        (
            await session.execute(
                select(SignalMessage.body_text, SignalMessage.metadata_json)
                .where(
                    SignalMessage.signal_id == conversation.id,
                    SignalMessage.kind == "agent_message",
                )
                .order_by(SignalMessage.created_at.desc())
                .limit(8)
            )
        ).all()
    )
    tail = ""
    for body, metadata_json in rows:
        if _is_error_agent_tail(body, metadata_json):
            continue
        tail = (body or "").strip()[:SUMMARY_MAX_CHARS]
        if tail:
            break
    opening = copy["idle_opening"]
    return f"{opening} {copy['idle_last'].format(tail=tail)}" if tail else opening


async def nudge_idle_sessions(
    session: AsyncSession,
    *,
    idle_seconds: int | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """Close idle inline sessions without asking the operator.

    Empty sessions (no operator turn) are discarded. Sessions that already
    have a leftover wrap-up card close immediately. Everyone else closes
    once the last operator turn is older than the idle window.
    """
    from app.config import get_settings

    idle = int(
        idle_seconds if idle_seconds is not None else get_settings().session_idle_seconds
    )
    if idle <= 0:
        return {"checked": 0, "closed": 0, "nudged": 0}
    cutoff = utcnow() - timedelta(seconds=idle)

    leftover = list(
        (
            await session.execute(
                select(Signal)
                .where(
                    Signal.channel == "assistant",
                    Signal.source == "agent_session",
                    Signal.session_state == "active",
                    Signal.context_signal_id.is_not(None),
                    alive(Signal),
                )
                .order_by(Signal.updated_at)
                .limit(500)
            )
        ).scalars().all()
    )

    closed = 0
    for conversation in leftover:
        if closed >= limit:
            break
        outcome = _load_outcome(conversation)
        last_user_at = (
            await session.execute(
                select(func.max(SignalMessage.created_at)).where(
                    SignalMessage.signal_id == conversation.id,
                    SignalMessage.kind == "user_message",
                )
            )
        ).scalar()
        pending_card = bool(outcome.get("checkout_decision_id"))
        idle_enough = last_user_at is not None and last_user_at <= cutoff
        empty_idle = last_user_at is None and (conversation.updated_at or cutoff) <= cutoff
        if not pending_card and not idle_enough and not empty_idle:
            continue
        thread_id = conversation.context_signal_id or conversation.id
        owner_id = conversation.owner_user_id
        if last_user_at is None:
            if owner_id is None:
                continue
            await discard_session(
                session, conversation.tenant_id, owner_id, thread_id, conversation.id
            )
            closed += 1
            continue
        result = await close_session(
            session,
            conversation.tenant_id,
            owner_id,
            thread_id,
            conversation.id,
            summary=await _idle_summary(session, conversation),
        )
        if result.get("state") == "closed":
            closed += 1
    return {"checked": len(leftover), "closed": closed, "nudged": closed}
