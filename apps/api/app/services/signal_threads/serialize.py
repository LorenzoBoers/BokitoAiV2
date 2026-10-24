"""Thread, message, and decision-card payloads."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Membership, User, user_numeric_id
from app.models.channel import ChannelAccount
from app.models.notification import DecisionRequest
from app.models.signal import (
    Signal,
    SignalEvent,
    SignalMessage,
    is_internal_channel,
)
from app.services.addressee import addressee_payload
from app.services.agent.reply_mode import INTERNAL_CHANNELS
from app.services.ownership import (
    owner_payload,
    turn_payload,
)
from app.services.signal_decisions import decision_provenance

logger = logging.getLogger(__name__)



def _iso(value: datetime | None) -> str | None:
    """Naive datetimes are stored as UTC; mark them as such so browsers do not
    parse them as local time (which shifted every timestamp by the UTC offset)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat() + "Z"
    return value.isoformat()


def _outcome_payload(signal: Signal) -> dict[str, Any] | None:
    """Latest closed episode's outcome, or None while it has none."""
    try:
        data = json.loads(getattr(signal, "outcome_json", "") or "{}")
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) and data.get("kind") else None


def _user_uuid_from_num(session_users: dict[int, UUID], user_num: int | None) -> UUID | None:
    if user_num is None:
        return None
    return session_users.get(user_num)


async def _user_map(session: AsyncSession, tenant_id: UUID) -> dict[int, UUID]:
    result = await session.execute(
        select(User).join(Membership, Membership.user_id == User.id).where(Membership.tenant_id == tenant_id)
    )
    return {user_numeric_id(u.id): u.id for u in result.scalars().all()}


async def resolve_email_account_by_numeric_id(
    session: AsyncSession,
    tenant_id: UUID,
    numeric_id: int,
) -> UUID | None:
    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.tenant_id == tenant_id, ChannelAccount.channel == "email"
        )
    )
    for account in result.scalars().all():
        if user_numeric_id(account.id) == numeric_id:
            return account.id
    return None


_ZERO_WIDTH_RE = re.compile(r"[\u200b\u200c\u200d\u2060\ufeff\u00ad\u034f]")
_QUOTE_CUT_RE = re.compile(
    r"(?:"
    r"\n\s*On .{10,160} wrote:"
    r"|\n\s*Op .{10,160} schreef .+:"
    r"|\n\s*-{2,}\s*Original Message\s*-{2,}"
    r"|\n\s*From:\s"
    r"|\n\s*Van:\s"
    r"|\n\s*Verzonden:\s"
    r"|\n\s*Sent:\s"
    r")",
    re.IGNORECASE,
)


def clean_message_preview(text: str, *, limit: int = 140) -> str:
    """Keep only the 'new' head of an email/chat body for list previews."""
    snippet = _ZERO_WIDTH_RE.sub("", text or "")
    snippet = snippet.replace("\r\n", "\n").replace("\r", "\n")
    cut = _QUOTE_CUT_RE.search(snippet)
    if cut:
        snippet = snippet[: cut.start()]
    snippet = snippet.strip().replace("\n", " ")
    snippet = re.sub(r"\s{2,}", " ", snippet)
    if snippet.startswith("[mock]"):
        snippet = snippet[len("[mock]") :].strip()
    return snippet[:limit]


def _is_placeholder_preview(text: str) -> bool:
    """True for mock/placeholder agent bodies that must never read as delivered."""
    low = (text or "").lower()
    return (
        low.startswith("[mock]")
        or low.startswith("i received your message about:")
        or low.startswith("ik heb je bericht ontvangen over:")
        or "placeholder reply while the workspace" in low
        or "tijdelijk antwoord zolang de workspace" in low
        or "without a live model" in low
        or "zonder live model" in low
    )


def message_is_mock(
    body_text: str | None,
    metadata: dict | None = None,
    *,
    auto_sent: bool = False,
) -> bool:
    """Whether a stored message is a mock/placeholder reply (not a live delivery)."""
    meta = metadata if isinstance(metadata, dict) else {}
    if meta.get("is_mock") is True:
        return True
    if meta.get("llm_mode") == "mock":
        return True
    if meta.get("llm_configured") is False:
        return True
    if _is_placeholder_preview(body_text or ""):
        return True
    return False


def message_delivered_to_customer(
    *,
    direction: str | None,
    auto_sent: bool,
    send_status: str | None,
    is_mock: bool,
    kind: str | None = None,
    channel: str | None = None,
) -> bool:
    """True only when an outbound agent/customer reply was actually delivered.

    Assistant, internal and team threads never reach a customer, so nothing
    on them counts as delivered.
    """
    if is_mock:
        return False
    if direction != "outbound":
        return False
    if (channel or "").lower() in INTERNAL_CHANNELS:
        return False
    if kind in ("internal_note", "system"):
        return False
    status = (send_status or "").lower()
    if status.startswith("failed") or status in ("scheduled", "sending"):
        return False
    if auto_sent:
        return True
    # Widget / chat: outbound agent bubbles reach the visitor without send_status.
    if not status or status in ("sent", "skipped"):
        return True
    return status.startswith("sent")


def _clean_thread_preview(text: str) -> str:
    return clean_message_preview(text, limit=140)


async def _latest_message_previews(
    session: AsyncSession, tenant_id: UUID, signal_ids: list[UUID]
) -> tuple[dict[UUID, tuple[str, str, bool]], dict[UUID, UUID]]:
    """Newest useful preview per thread, and the agent who sent the newest agent message.

    Preview is ``(snippet, direction, by_agent)``. ``row_number()`` keeps a few
    recent user/agent rows per signal, enough to prefer a real line over a placeholder.
    """
    if not signal_ids:
        return {}, {}
    ranked = (
        select(
            SignalMessage.signal_id,
            SignalMessage.body_preview,
            SignalMessage.body_text,
            SignalMessage.kind,
            SignalMessage.direction,
            SignalMessage.author_agent_id,
            SignalMessage.metadata_json,
            func.row_number()
            .over(
                partition_by=SignalMessage.signal_id,
                order_by=SignalMessage.created_at.desc(),
            )
            .label("rn"),
        )
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.signal_id.in_(signal_ids),
            or_(
                SignalMessage.kind.in_(("user_message", "agent_message")),
                # "Handled outside Bokito" is the team's last word on the thread.
                and_(SignalMessage.kind == "system_event", SignalMessage.direction == "outbound"),
            ),
        )
        .subquery()
    )
    result = await session.execute(
        select(
            ranked.c.signal_id,
            ranked.c.body_preview,
            ranked.c.body_text,
            ranked.c.kind,
            ranked.c.direction,
            ranked.c.author_agent_id,
            ranked.c.metadata_json,
        )
        .where(ranked.c.rn <= 8)
        .order_by(ranked.c.rn.asc())
    )
    user_previews: dict[UUID, tuple[str, str, bool]] = {}
    other_previews: dict[UUID, tuple[str, str, bool]] = {}
    for signal_id, preview, text, kind, direction, author_agent_id, metadata_json in result.all():
        # Decision-button echoes ("End session", "Ja") are not useful list
        # snippets — prefer the real customer / agent turn underneath.
        try:
            meta = json.loads(metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if isinstance(meta, dict) and meta.get("decision_response"):
            continue
        raw = (preview or text or "").strip()
        is_placeholder = _is_placeholder_preview(raw)
        snippet = _clean_thread_preview(raw)
        if not snippet:
            continue
        resolved_dir = direction or ("inbound" if kind == "user_message" else "outbound")
        entry = (snippet, resolved_dir, author_agent_id is not None)
        if kind == "user_message" and signal_id not in user_previews:
            user_previews[signal_id] = entry
        if not is_placeholder and signal_id not in other_previews:
            other_previews[signal_id] = entry
    out: dict[UUID, tuple[str, str, bool]] = {}
    for signal_id in signal_ids:
        out[signal_id] = other_previews.get(signal_id) or user_previews.get(signal_id, ("", "", False))
    # The face is the newest agent message on the whole thread, not only the
    # eight rows the preview looks at.
    ranked_speakers = (
        select(
            SignalMessage.signal_id,
            SignalMessage.author_agent_id,
            func.row_number()
            .over(
                partition_by=SignalMessage.signal_id,
                order_by=(SignalMessage.seq.desc(), SignalMessage.created_at.desc()),
            )
            .label("rn"),
        )
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.signal_id.in_(signal_ids),
            SignalMessage.kind == "agent_message",
            SignalMessage.author_agent_id.is_not(None),
        )
        .subquery()
    )
    speaker_rows = await session.execute(
        select(ranked_speakers.c.signal_id, ranked_speakers.c.author_agent_id).where(
            ranked_speakers.c.rn == 1
        )
    )
    speakers = {signal_id: author for signal_id, author in speaker_rows.all() if author}
    return out, speakers


_OMIT = object()


def _active_turn_payload(signal: Signal) -> dict[str, Any] | None:
    """Parse multi-agent floor state for thread detail clients."""
    raw = getattr(signal, "active_turn_json", None) or "{}"
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not data.get("ref_id"):
        return None
    return data


def floor_speaker_id(signal: Signal) -> UUID | None:
    """The agent producing the current turn, when one is running."""
    floor = _active_turn_payload(signal)
    if not floor or floor.get("status") != "running":
        return None
    if str(floor.get("kind") or "") != "agent":
        return None
    try:
        return UUID(str(floor["ref_id"]))
    except (TypeError, ValueError):
        return None


async def last_agent_author(session: AsyncSession, signal_id: UUID) -> UUID | None:
    """The agent who sent the newest agent message on this conversation."""
    return (
        await session.execute(
            select(SignalMessage.author_agent_id)
            .where(
                SignalMessage.signal_id == signal_id,
                SignalMessage.kind == "agent_message",
                SignalMessage.author_agent_id.is_not(None),
            )
            .order_by(SignalMessage.seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def conversation_speaker(session: AsyncSession, signal: Signal) -> Agent | None:
    """Who this conversation shows: the running turn, else the last sender, else the pinned agent."""
    agent_id = floor_speaker_id(signal) or await last_agent_author(session, signal.id) or signal.agent_id
    if agent_id is None:
        return None
    agent = await session.get(Agent, agent_id)
    if agent is None or agent.tenant_id != signal.tenant_id:
        return None
    return agent


def _speaker_payload(agent: Agent) -> dict[str, Any]:
    from app.services.agent_avatar import avatar_payload

    avatar = avatar_payload(agent)
    return {
        "id": str(agent.id),
        "name": agent.name,
        "kind": agent.kind,
        "avatar_kind": avatar["avatar_kind"],
        "avatar_icon": avatar["avatar_icon"],
        "avatar_color": avatar["avatar_color"],
        "avatar_shape": avatar.get("avatar_shape"),
        "avatar_image_url": avatar["avatar_image_url"],
    }


def serialize_thread(
    signal: Signal,
    *,
    is_pinned: bool = False,
    user_num: int | None = None,
    agent: Agent | None = None,
    last_preview: str | None = None,
    last_direction: str | None = None,
    last_by_agent: bool = False,
    has_open_decision: bool = False,
    ai_handling: dict[str, Any] | None = None,
    ticket: dict[str, Any] | None | object = _OMIT,
    tags: list[str] | object = _OMIT,
    inherited_tags: list[str] | object = _OMIT,
    folder_paths: list[dict[str, Any]] | object = _OMIT,
    schedule: dict[str, Any] | None | object = _OMIT,
    speaker: Agent | None | object = _OMIT,
) -> dict[str, Any]:
    from app.services.thread_schedule import thread_details

    assignee_num = user_numeric_id(signal.assigned_user_id) if signal.assigned_user_id else None
    email_conn_id = user_numeric_id(signal.channel_account_id) if signal.channel_account_id else None
    # Assistant chats are conversations (Alle communicatie + Agents folder);
    # only agent-run threads are "internal" and hidden from the Open queue.
    if signal.channel == "assistant":
        folder = "assistant"
    elif is_internal_channel(signal.channel):
        folder = "internal"
    else:
        folder = "external"
    payload: dict[str, Any] = {
        "id": str(signal.id),
        "organisation_id": str(signal.tenant_id),
        "email_connection_id": email_conn_id,
        "channel_account_id": str(signal.channel_account_id) if signal.channel_account_id else None,
        "connection_id": str(signal.connection_id) if signal.connection_id else None,
        "graph_conversation_id": signal.external_id or "",
        "email_subject": signal.subject,
        "last_message_preview": last_preview or "",
        "last_message_direction": last_direction or "",
        "last_message_by_agent": last_by_agent,
        "contact_id": str(signal.contact_id) if signal.contact_id else None,
        "contact_email": signal.contact_email,
        "contact_name": signal.contact_name,
        "contact_phone": signal.contact_phone,
        "contact_basis": signal.contact_basis or "",
        "status": signal.status,
        "next_at": _iso(signal.next_at),
        "ends_at": _iso(signal.ends_at),
        "hidden_until": _iso(signal.hidden_until),
        "schedule_details": thread_details(signal),
        "priority": signal.priority,
        "assigned_to_user_id": assignee_num,
        "owner": owner_payload(signal),
        "turn": {
            **turn_payload(signal),
            "user_num": user_numeric_id(signal.turn_user_id) if signal.turn_user_id else None,
        },
        "ai_handling": ai_handling,
        "suggested_actions": json.loads(signal.suggested_actions_json or "[]"),
        # AI triage (INTERPRETATION layer) shown on the thread header.
        "urgency": signal.urgency,
        "certainty": signal.certainty,
        "ai_summary": signal.summary,
        "triaged_at": _iso(signal.triaged_at),
        "outcome": _outcome_payload(signal),
        "last_message_at": _iso(signal.last_message_at),
        "has_unread": signal.has_unread,
        "has_open_decision": has_open_decision,
        "is_example": bool(signal.is_example),
        "is_pinned": is_pinned,
        "channel": signal.channel,
        "source": signal.source or "",
        "folder": folder,
        "agent_id": str(signal.agent_id) if signal.agent_id else None,
        "agent_name": agent.name if agent else None,
        "agent_kind": agent.kind if agent else None,
        "folder_id": str(signal.project_id) if signal.project_id else None,
        "project_id": str(signal.project_id) if signal.project_id else None,
        "parent_signal_id": str(signal.parent_signal_id) if signal.parent_signal_id else None,
        "superseded_by_id": str(signal.superseded_by_id) if signal.superseded_by_id else None,
        "created_at": _iso(signal.created_at),
    }
    # The conversation's ticket and its free tags are loaded in batches. Rows built without them omit the keys so clients
    # keep the known values.
    if ticket is not _OMIT:
        payload["ticket"] = ticket
    if tags is not _OMIT:
        payload["tags"] = tags
    if inherited_tags is not _OMIT:
        payload["inherited_tags"] = inherited_tags
    if folder_paths is not _OMIT:
        payload["folder_paths"] = folder_paths
    if schedule is not _OMIT:
        payload["schedule"] = schedule
    if agent:
        from app.services.agent_avatar import avatar_payload

        av = avatar_payload(agent)
        payload["agent_avatar_kind"] = av["avatar_kind"]
        payload["agent_avatar_icon"] = av["avatar_icon"]
        payload["agent_avatar_color"] = av["avatar_color"]
        payload["agent_avatar_shape"] = av.get("avatar_shape")
        payload["agent_avatar_image_url"] = av["avatar_image_url"]
    if speaker is not _OMIT:
        payload["speaker"] = _speaker_payload(speaker) if isinstance(speaker, Agent) else None
    return payload


def message_proposal_ids(messages: list[SignalMessage]) -> dict[UUID, UUID]:
    """Message id -> decision id for agent bubbles that carry a proposal."""
    found: dict[UUID, UUID] = {}
    for message in messages:
        if message.decision_id or '"proposal"' not in (message.metadata_json or ""):
            continue
        try:
            meta = json.loads(message.metadata_json or "{}")
            found[message.id] = UUID(str(meta["proposal"]["decision_id"]))
        except (json.JSONDecodeError, KeyError, TypeError, ValueError):
            continue
    return found


def message_bundle_ids(messages: list[SignalMessage]) -> dict[UUID, list[UUID]]:
    """Message id -> decision ids of the action bundle an agent bubble carries."""
    found: dict[UUID, list[UUID]] = {}
    for message in messages:
        if message.decision_id or '"bundle"' not in (message.metadata_json or ""):
            continue
        try:
            meta = json.loads(message.metadata_json or "{}")
            rows = meta["proposal"]["bundle"]
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
        ids: list[UUID] = []
        for row in rows if isinstance(rows, list) else []:
            try:
                ids.append(UUID(str(row["decision_id"])))
            except (KeyError, TypeError, ValueError):
                continue
        if ids:
            found[message.id] = ids
    return found


def bundle_entry_payload(decision: DecisionRequest, *, card_message_id: str | None = None) -> dict[str, Any]:
    """One action in a bundle: what approving runs, its state and learn hook."""
    from app.tools.decision_copy import describe_action

    try:
        options = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        options = []
    options = [o for o in (options if isinstance(options, list) else []) if isinstance(o, dict)]
    approve = next(
        (o for o in options if str(o.get("action_type") or "") not in ("", "reject", "defer", "escalate")),
        None,
    )
    reject = next((o for o in options if str(o.get("action_type") or "") == "reject"), None)
    action_type = str(approve.get("action_type") or "") if approve else ""
    payload = approve.get("payload") if approve and isinstance(approve.get("payload"), dict) else {}
    tool = action_type
    tool_input: dict[str, Any] = payload
    describe = approve.get("describe") if approve and isinstance(approve.get("describe"), dict) else None
    if describe and describe.get("tool"):
        # Platform changes carry the tool call behind them.
        tool = str(describe["tool"])
        tool_input = describe.get("input") if isinstance(describe.get("input"), dict) else {}
    elif action_type == "accept_platform_change":
        tool = ""
    return {
        "decision_id": str(decision.id),
        "card_message_id": card_message_id or (str(decision.message_id) if decision.message_id else None),
        "title": decision.title,
        "summary": decision.summary,
        "status": decision.status,
        "chosen_option_id": decision.chosen_option_id,
        "resolved_at": _iso(decision.resolved_at),
        "resolved_by_user_id": (
            str(decision.resolved_by_user_id) if decision.resolved_by_user_id else None
        ),
        "approve_option_id": approve.get("id") if approve else "approve",
        "reject_option_id": reject.get("id") if reject else "reject",
        "action_type": action_type,
        "action": describe_action(tool, tool_input) if tool else None,
        "learn": approve.get("learn") if approve and isinstance(approve.get("learn"), dict) else None,
        "platform_change_id": str(decision.platform_change_id) if decision.platform_change_id else None,
    }


async def _user_display_names(session: AsyncSession, user_ids: list[UUID]) -> dict[UUID, str]:
    ids = list({uid for uid in user_ids if uid})
    if not ids:
        return {}
    from app.models.auth import User

    rows = await session.execute(select(User).where(User.id.in_(ids)))
    return {u.id: (u.display_name or u.email) for u in rows.scalars().all()}


def proposal_payload(
    proposal_meta: dict[str, Any],
    decision: DecisionRequest | None,
    *,
    resolved_by_name: str | None = None,
    resolved_by_user_id: UUID | None = None,
    resolver_names: dict[UUID, str] | None = None,
    bundle_decisions: list[DecisionRequest] | None = None,
) -> dict[str, Any]:
    """The proposal an agent bubble carries: its decision's live state plus the
    item snapshot taken when the agent raised it. ``bundle`` lists every action
    card of the turn so the client renders one approve-all / pick-some card."""
    selection = str(proposal_meta.get("selection") or "single").lower()
    if selection not in ("single", "multiple"):
        selection = "single"
    out: dict[str, Any] = {
        "decision_id": str(proposal_meta["decision_id"]),
        "items": proposal_meta.get("items") if isinstance(proposal_meta.get("items"), list) else [],
        "question": str(proposal_meta.get("question") or "") or None,
        "selection": selection,
        "status": "missing",
        "options": [],
    }
    bundle_meta = proposal_meta.get("bundle") if isinstance(proposal_meta.get("bundle"), list) else []
    if bundle_meta:
        by_id = {str(d.id): d for d in bundle_decisions or []}
        names = resolver_names or {}
        rows: list[dict[str, Any]] = []
        for row in bundle_meta:
            if not isinstance(row, dict) or not row.get("decision_id"):
                continue
            found = by_id.get(str(row["decision_id"]))
            if found is None:
                rows.append({"decision_id": str(row["decision_id"]), "status": "missing"})
            else:
                entry = bundle_entry_payload(found, card_message_id=row.get("card_message_id"))
                if isinstance(row.get("items"), list):
                    entry["items"] = [i for i in row["items"] if isinstance(i, dict)]
                if found.resolved_by_user_id:
                    entry["resolved_by"] = names.get(found.resolved_by_user_id)
                rows.append(entry)
        out["bundle"] = rows
        if proposal_meta.get("bundle_id"):
            out["bundle_id"] = str(proposal_meta["bundle_id"])
    if decision is None:
        return out
    try:
        options = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        options = []
    # Multi-select stores ids as "a,b,c" in chosen_option_id.
    raw_chosen = str(decision.chosen_option_id or "")
    chosen_ids = [part for part in raw_chosen.split(",") if part] if raw_chosen else []
    resolver_id = resolved_by_user_id or decision.resolved_by_user_id
    out.update(
        {
            "status": decision.status,
            "message_id": str(decision.message_id) if decision.message_id else None,
            "title": decision.title,
            "summary": decision.summary,
            "options": options if isinstance(options, list) else [],
            "chosen_option_id": chosen_ids[0] if chosen_ids else decision.chosen_option_id,
            "chosen_option_ids": chosen_ids,
            "resolved_at": _iso(decision.resolved_at),
            "resolved_by": resolved_by_name,
            "resolved_by_user_id": str(resolver_id) if resolver_id else None,
            "addressee": addressee_payload(decision),
        }
    )
    return out


_ANY_MENTION = re.compile(r"@\[([^\]]+)\]\((agent|team|user):([0-9a-fA-F-]{36})\)")


def mention_ids(texts: list[str]) -> set[tuple[str, UUID]]:
    found: set[tuple[str, UUID]] = set()
    for text in texts:
        for _name, kind, raw in _ANY_MENTION.findall(text or ""):
            try:
                found.add((kind, UUID(raw)))
            except ValueError:
                continue
    return found


def message_mentions(body_text: str, names: dict[UUID, str] | None = None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for name, kind, raw in _ANY_MENTION.findall(body_text or ""):
        try:
            ref = UUID(raw)
        except ValueError:
            continue
        if str(ref) in seen:
            continue
        seen.add(str(ref))
        out.append({"kind": kind, "id": str(ref), "name": (names or {}).get(ref) or name})
    return out


async def mention_names(session: AsyncSession, tenant_id: UUID, texts: list[str]) -> dict[UUID, str]:
    """Current names for the agents, teams and people mentioned in ``texts``."""
    from app.models.auth import User
    from app.models.team import Team

    refs = mention_ids(texts)
    by_kind: dict[str, list[UUID]] = {}
    for kind, ref in refs:
        by_kind.setdefault(kind, []).append(ref)
    names: dict[UUID, str] = {}
    if by_kind.get("agent"):
        rows = await session.execute(
            select(Agent.id, Agent.name).where(Agent.tenant_id == tenant_id, Agent.id.in_(by_kind["agent"]))
        )
        names.update({rid: n for rid, n in rows.all() if n})
    if by_kind.get("team"):
        rows = await session.execute(
            select(Team.id, Team.name).where(Team.tenant_id == tenant_id, Team.id.in_(by_kind["team"]))
        )
        names.update({rid: n for rid, n in rows.all() if n})
    if by_kind.get("user"):
        rows = await session.execute(
            select(User.id, User.display_name, User.email).where(User.id.in_(by_kind["user"]))
        )
        names.update({rid: dn or (em or "").split("@")[0] for rid, dn, em in rows.all() if dn or em})
    return names


def serialize_message(
    message: SignalMessage,
    *,
    decision: DecisionRequest | None = None,
    include_html: bool = True,
    include_trace: bool = True,
    channel: str | None = None,
    proposal_decision: DecisionRequest | None = None,
    proposal_resolved_by: str | None = None,
    proposal_resolver_names: dict[UUID, str] | None = None,
    bundle_decisions: list[DecisionRequest] | None = None,
    mention_names: dict[UUID, str] | None = None,
) -> dict[str, Any]:
    """Serialize a message for the timeline.

    ``payload.mentions`` lists ``@agent`` / ``@team`` / ``@user`` chips with the
    current name from ``mention_names`` (the name saved in the text otherwise).

    Timeline windows pass ``include_html=False`` / ``include_trace=False`` so
    chat and assistant threads stay light. Email keeps HTML inline (the
    composer and LazyEmailHtmlFrame need it). Full HTML/trace load via
    ``get_message``.
    """
    author_num = user_numeric_id(message.author_user_id) if message.author_user_id else None
    payload: dict[str, Any] = {}
    if message.decision_id:
        payload["decision_id"] = str(message.decision_id)
    if message.author_agent_id:
        payload["agent_id"] = str(message.author_agent_id)
    if decision:
        try:
            options = json.loads(decision.options_json or "[]")
        except json.JSONDecodeError:
            options = []
        payload["decision"] = {
            "id": str(decision.id),
            "title": decision.title,
            "summary": decision.summary,
            "status": decision.status,
            "options": options,
            # Provenance so the card can name and link its source.
            "source": decision_provenance(decision),
            "addressee": addressee_payload(decision),
            "resolved_by_user_id": (
                str(decision.resolved_by_user_id) if decision.resolved_by_user_id else None
            ),
            "resolved_at": _iso(decision.resolved_at),
            "chosen_option_id": decision.chosen_option_id,
        }
        from app.services.auto_review import verdict_payload

        review = verdict_payload(decision.auto_review_json)
        if review is not None:
            payload["decision"]["auto_review"] = review
        if decision.status == "deferred" and decision.chosen_option_id:
            # Why the card was set aside (human_replied, superseded_by_inbound,
            # superseded_by_external_reply, sibling_thread, handled_externally).
            payload["decision"]["resolution_reason"] = decision.chosen_option_id
    try:
        meta = json.loads(message.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    if "decision" in payload:
        # Anchor: the inbound message this proposal answers. The composer
        # compares it with the newest inbound message to flag stale drafts.
        if meta.get("based_on_message_id"):
            payload["decision"]["based_on_message_id"] = str(meta["based_on_message_id"])
        if meta.get("superseded_by_signal_id"):
            payload["decision"]["superseded_by_signal_id"] = str(meta["superseded_by_signal_id"])
        if isinstance(meta.get("proposal_items"), list):
            payload["decision"]["items"] = meta["proposal_items"]
        if meta.get("question"):
            payload["decision"]["question"] = str(meta["question"])
        if str(meta.get("selection") or "").lower() in ("single", "multiple"):
            payload["decision"]["selection"] = str(meta["selection"]).lower()
    if message.decision_id and meta.get("attached_to_message_id"):
        payload["attached_to_message_id"] = str(meta["attached_to_message_id"])
    if meta.get("system_note"):
        # Handover note the agent left when it escalated (services/handover.py).
        payload["system_note"] = True
        if meta.get("handover"):
            payload["handover"] = str(meta["handover"])
    if isinstance(meta.get("items"), list):
        payload["items"] = meta["items"]
    guard = meta.get("prompt_guard")
    if isinstance(guard, dict) and guard.get("flagged"):
        payload["prompt_guard"] = {"signals": [str(s) for s in guard.get("signals") or []]}
    if meta.get("decision_response"):
        payload["decision_response"] = True
        if meta.get("decision_id"):
            payload["decision_response_decision_id"] = str(meta["decision_id"])
        # Bundle resolves stamp many ids; the timeline needs them so it does
        # not also synthesize a second "Afwijzen" bubble.
        if isinstance(meta.get("decision_ids"), list):
            payload["decision_response_decision_ids"] = [
                str(x) for x in meta["decision_ids"] if x
            ]
        if isinstance(meta.get("items"), list):
            payload["decision_response_items"] = meta["items"]
        # Lets the timeline hide checkout button-echoes ("End session") that
        # older builds posted as chat bubbles next to the resolved card.
        if meta.get("option_id"):
            payload["decision_response_option_id"] = str(meta["option_id"])
        if meta.get("option_ids") and isinstance(meta["option_ids"], list):
            payload["decision_response_option_ids"] = [
                str(x) for x in meta["option_ids"] if x
            ]
    proposal_meta = meta.get("proposal")
    if isinstance(proposal_meta, dict) and proposal_meta.get("decision_id"):
        # Bubble-level items are the source of truth for showcases.
        if isinstance(meta.get("items"), list) and meta["items"]:
            proposal_meta = {**proposal_meta, "items": meta["items"]}
        payload["proposal"] = proposal_payload(
            proposal_meta,
            proposal_decision,
            resolved_by_name=proposal_resolved_by,
            resolved_by_user_id=(
                proposal_decision.resolved_by_user_id if proposal_decision else None
            ),
            resolver_names=proposal_resolver_names,
            bundle_decisions=bundle_decisions,
        )
    from app.services.agent.turn_persist import message_activity

    activity = message_activity(meta, detail=include_trace)
    has_trace = bool(activity["activity"] or activity["activity_after"])
    if has_trace:
        payload["activity"] = activity["activity"]
        if activity["activity_after"]:
            payload["activity_after"] = activity["activity_after"]
        payload["activity_detail"] = include_trace
        if activity.get("history"):
            payload["history"] = activity["history"]
    if meta.get("turn_id"):
        payload["turn_id"] = str(meta["turn_id"])
    if meta.get("segment_id"):
        payload["segment_id"] = str(meta["segment_id"])
    mentions = message_mentions(message.body_text or "", mention_names)
    if mentions:
        payload["mentions"] = mentions
    if include_trace and isinstance(meta.get("usage"), dict) and meta["usage"]:
        payload["usage"] = meta["usage"]
    is_mock = message_is_mock(
        message.body_text, meta, auto_sent=bool(message.auto_sent)
    )
    delivered = message_delivered_to_customer(
        direction=message.direction,
        auto_sent=bool(message.auto_sent),
        send_status=message.send_status,
        is_mock=is_mock,
        kind=message.kind,
        channel=channel,
    )
    if is_mock:
        payload["is_mock"] = True
        payload["llm_mode"] = "mock"
    elif meta.get("llm_mode"):
        payload["llm_mode"] = meta.get("llm_mode")
    # Workbench job card: Follow up / Stop on status_update and task_result rows.
    if meta.get("work_job_id"):
        payload["work_job_id"] = str(meta["work_job_id"])
        if meta.get("provider"):
            payload["workbench_provider"] = str(meta["provider"])
        if meta.get("kind"):
            payload["workbench_kind"] = str(meta["kind"])
        if isinstance(meta.get("artifact"), dict):
            payload["workbench_artifact"] = meta["artifact"]
    payload["delivered_to_customer"] = delivered
    # Settled outside Bokito (call, personal WhatsApp, other mailbox): the
    # timeline pill is rendered from these fields in the operator's language.
    if meta.get("handled_externally"):
        payload["handled_externally"] = {
            "channel": str(meta.get("channel") or "other"),
            "by_name": str(meta.get("by_name") or ""),
            "note": str(meta.get("note") or ""),
        }
    # Team reply logged from a colleague's own mailbox (Sent items sync).
    if meta.get("origin") == "external_mailbox":
        payload["origin"] = "external_mailbox"
        payload["mailbox_provider"] = str(meta.get("provider") or "")
        payload["mailbox"] = str(meta.get("mailbox") or "")
        if meta.get("sender_name"):
            payload["sender_name"] = str(meta["sender_name"])
    # A teammate forwarded someone else's mail into the inbox.
    if isinstance(meta.get("forwarded_from"), dict):
        payload["forwarded_from"] = meta["forwarded_from"]
    # One collapsible call log. The timeline reads source + call_log.
    if meta.get("source") == "agent_call" and isinstance(meta.get("call_log"), dict):
        payload["source"] = "agent_call"
        payload["call_log"] = meta["call_log"]
    # Dock hold-to-talk. The timeline marks both the person's line and the reply.
    if meta.get("source") == "intercom":
        payload["source"] = "intercom"
    has_html = bool((message.body_html or "").strip())
    body_html = (message.body_html or None) if include_html else None
    from app.services.agent.turn_surface import spoken_text

    _raw_body = message.body_text or ""
    _spoken = spoken_text(_raw_body, activity.get("history") if isinstance(activity, dict) else None)
    _preview = _spoken[:200] if _spoken != _raw_body else (message.body_preview or _spoken[:200])
    return {
        "id": str(message.id),
        "thread_id": str(message.signal_id),
        "signal_id": str(message.signal_id),
        "seq": message.seq,
        "connection_id": None,
        "kind": message.kind,
        "direction": message.direction,
        "from_address": message.from_address,
        "to_addresses": message.to_addresses,
        "cc": str(meta.get("cc") or "") or None,
        "bcc": str(meta.get("bcc") or "") or None,
        # Inbound To header (comma-separated) so the client can build
        # reply-all recipient lists; outbound rows store it on to_addresses.
        "to_header": str(meta.get("to") or "") or None,
        "reply_mode": str(meta.get("reply_mode") or "") or None,
        "subject": message.subject,
        "body_preview": _preview,
        "body_text": _spoken,
        "body_html": body_html,
        "has_html": has_html,
        "has_activity": has_trace,
        "graph_message_id": message.external_id,
        "in_reply_to": None,
        "author_user_id": author_num,
        "is_read": message.direction != "inbound",
        "send_status": message.send_status,
        "send_after": _iso(message.send_after),
        "auto_sent": bool(message.auto_sent),
        "is_mock": is_mock,
        "delivered_to_customer": delivered,
        "attachments": _safe_json_list(message.attachments_json),
        "decision_id": str(message.decision_id) if message.decision_id else None,
        "payload": payload,
        "received_at": _iso(message.received_at),
        "created_at": _iso(message.created_at),
    }


def _safe_json_list(raw: str | None) -> list[Any]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return data if isinstance(data, list) else []


def _safe_json_dict(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def serialize_event(event: SignalEvent, *, user_num_map: dict[UUID, int] | None = None) -> dict[str, Any]:
    actor_num = None
    if user_num_map and event.actor_id:
        try:
            actor_num = user_num_map.get(UUID(event.actor_id))
        except ValueError:
            actor_num = None
    actor_type = event.actor_type or "system"
    return {
        "id": str(event.id),
        "thread_id": str(event.signal_id),
        "signal_id": str(event.signal_id),
        "event_type": event.event_type,
        "actor_type": actor_type,
        "actor_user_id": actor_num,
        "actor_agent_id": event.actor_id if actor_type == "agent" and event.actor_id else None,
        "payload": _safe_json_dict(event.payload_json),
        "created_at": _iso(event.created_at),
    }


async def _resolve_thread_agent(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    messages: list[SignalMessage] | None = None,
    *,
    fallback_to_lead: bool = True,
) -> Agent | None:
    if signal.agent_id:
        result = await session.execute(
            select(Agent).where(Agent.id == signal.agent_id, Agent.tenant_id == tenant_id)
        )
        agent = result.scalar_one_or_none()
        if agent and agent.is_active and agent.kind != "archived":
            return agent
    if messages:
        for message in reversed(messages):
            if not message.author_agent_id:
                continue
            result = await session.execute(
                select(Agent).where(
                    Agent.id == message.author_agent_id,
                    Agent.tenant_id == tenant_id,
                )
            )
            agent = result.scalar_one_or_none()
            if agent and agent.is_active and agent.kind != "archived":
                return agent
    if signal.project_id:
        from app.services.projects import project_default_agent

        default_agent = await project_default_agent(session, tenant_id, signal.project_id)
        if default_agent:
            return default_agent
    if not fallback_to_lead:
        return None
    from app.services.lead_agent import get_lead_agent

    return await get_lead_agent(session, tenant_id)
