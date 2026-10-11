"""Signal thread service with inbox-parity for the unified Messages hub."""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message, publish_thread_update
from app.models.agent import Agent
from app.models.auth import Membership, User, user_numeric_id
from app.services.addressee import addressee_payload
from app.services.agent.reply_mode import INTERNAL_CHANNELS
from app.services.ownership import (
    for_you_clause,
    owner_payload,
    pick_up,
    picked_up_event,
    resolve_assignee,
    set_owner,
    turn_is_mine_clause,
    turn_payload,
    unassigned_predicate,
)
from app.models.channel import ChannelAccount, Contact
from app.models.notification import DecisionRequest, Notification
from app.services.signal_decisions import decision_provenance
from app.models.signal import (
    EXTERNAL_CHANNELS,
    Signal,
    SignalEvent,
    SignalMessage,
    SignalThreadPin,
    is_internal_channel,
)


logger = logging.getLogger(__name__)


def _iso(value: datetime | None) -> str | None:
    """Naive datetimes are stored as UTC; mark them as such so browsers do not
    parse them as local time (which shifted every timestamp by the UTC offset)."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.isoformat() + "Z"
    return value.isoformat()


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
) -> dict[UUID, tuple[str, str, bool]]:
    """Newest useful preview per thread: ``(snippet, direction, by_agent)``.

    Uses ``row_number()`` so each signal contributes at most a few recent
    user/agent rows (enough to prefer a non-placeholder over a placeholder).
    """
    if not signal_ids:
        return {}
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
        ).where(ranked.c.rn <= 8)
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
    return out


_OMIT = object()


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
    schedule: dict[str, Any] | None | object = _OMIT,
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
        "category": signal.category,
        "urgency": signal.urgency,
        "certainty": signal.certainty,
        "ai_summary": signal.summary,
        "triaged_at": _iso(signal.triaged_at),
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
    if schedule is not _OMIT:
        payload["schedule"] = schedule
    if agent:
        from app.services.agent_avatar import avatar_payload

        av = avatar_payload(agent)
        payload["agent_avatar_kind"] = av["avatar_kind"]
        payload["agent_avatar_icon"] = av["avatar_icon"]
        payload["agent_avatar_color"] = av["avatar_color"]
        payload["agent_avatar_image_url"] = av["avatar_image_url"]
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
        rows: list[dict[str, Any]] = []
        for row in bundle_meta:
            if not isinstance(row, dict) or not row.get("decision_id"):
                continue
            found = by_id.get(str(row["decision_id"]))
            if found is None:
                rows.append({"decision_id": str(row["decision_id"]), "status": "missing"})
            else:
                rows.append(bundle_entry_payload(found, card_message_id=row.get("card_message_id")))
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
            "addressee": addressee_payload(decision),
        }
    )
    return out


def serialize_message(
    message: SignalMessage,
    *,
    decision: DecisionRequest | None = None,
    include_html: bool = True,
    include_trace: bool = True,
    channel: str | None = None,
    proposal_decision: DecisionRequest | None = None,
    proposal_resolved_by: str | None = None,
    bundle_decisions: list[DecisionRequest] | None = None,
) -> dict[str, Any]:
    """Serialize a message for the timeline.

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
        }
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
    if meta.get("decision_response"):
        payload["decision_response"] = True
        if meta.get("decision_id"):
            payload["decision_response_decision_id"] = str(meta["decision_id"])
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
    if meta.get("turn_id"):
        payload["turn_id"] = str(meta["turn_id"])
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
    has_html = bool((message.body_html or "").strip())
    body_html = (message.body_html or None) if include_html else None
    return {
        "id": str(message.id),
        "thread_id": str(message.signal_id),
        "signal_id": str(message.signal_id),
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
        "body_preview": message.body_preview or (message.body_text or "")[:200],
        "body_text": message.body_text,
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
        "attachments": json.loads(message.attachments_json or "[]"),
        "decision_id": str(message.decision_id) if message.decision_id else None,
        "payload": payload,
        "received_at": _iso(message.received_at),
        "created_at": _iso(message.created_at),
    }


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
        "payload": json.loads(event.payload_json or "{}"),
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
        if agent:
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
            if agent:
                return agent
    if signal.project_id:
        from app.models.project import Project
        from app.services.projects import project_default_agent

        default_agent = await project_default_agent(session, tenant_id, signal.project_id)
        if default_agent:
            return default_agent
        project_result = await session.execute(
            select(Project).where(Project.id == signal.project_id, Project.tenant_id == tenant_id)
        )
        project = project_result.scalar_one_or_none()
        if project and project.po_agent_id:
            result = await session.execute(
                select(Agent).where(Agent.id == project.po_agent_id, Agent.tenant_id == tenant_id)
            )
            agent = result.scalar_one_or_none()
            if agent:
                return agent
    if not fallback_to_lead:
        return None
    from app.services.lead_agent import get_lead_agent

    return await get_lead_agent(session, tenant_id)


async def _pinned_ids(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> set[UUID]:
    result = await session.execute(
        select(SignalThreadPin.signal_id).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
        )
    )
    return {row for row in result.scalars().all()}


def _open_decision_filters(
    tenant_id: UUID, *, signal_ids: list[UUID] | None = None, tip_cards: bool = False
) -> list[Any]:
    """Shared WHERE clauses for awaiting decisions.

    Personal assistant chats and "No reply needed" tip cards are not operator
    blockers, so every attention count and the Decisions queue skip them.
    ``tip_cards`` selects only the tip cards instead.
    """
    from app.services.automated_mail import NO_REPLY_DECISION_TITLE

    filters: list[Any] = [
        Signal.tenant_id == tenant_id,
        Signal.channel != "assistant",
        Signal.status.notin_(("closed", "spam")),
        SignalMessage.kind == "decision_request",
        DecisionRequest.status == "awaiting_human",
        (
            DecisionRequest.title == NO_REPLY_DECISION_TITLE
            if tip_cards
            else DecisionRequest.title != NO_REPLY_DECISION_TITLE
        ),
    ]
    if signal_ids is not None:
        if not signal_ids:
            filters.append(Signal.id.is_(None))
        else:
            filters.append(Signal.id.in_(signal_ids))
    return filters


async def _signals_with_open_decisions(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_ids: list[UUID] | None = None,
) -> set[UUID]:
    """Signals with a real awaiting decision (reply draft, tool gate, escalate).

    Excludes "No reply needed" tip cards on automated mail — those must not
    inflate Agents / Cockpit attention counts or the Decisions queue.
    Pass ``signal_ids`` to scope to a list page instead of the whole tenant.
    """
    result = await session.execute(
        select(Signal.id)
        .join(SignalMessage, SignalMessage.signal_id == Signal.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(*_open_decision_filters(tenant_id, signal_ids=signal_ids))
    )
    return {row for row in result.scalars().all()}


async def _signal_has_open_decision(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID
) -> bool:
    """EXISTS check for one thread — used by get_thread."""
    result = await session.execute(
        select(Signal.id)
        .join(SignalMessage, SignalMessage.signal_id == Signal.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(*_open_decision_filters(tenant_id, signal_ids=[signal_id]))
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


def _visibility_predicate(visible_account_ids: set[UUID] | None):
    """Signal-level ACL clause; threads without an account stay visible."""
    if visible_account_ids is None:
        return None
    return or_(
        Signal.channel_account_id.is_(None),
        Signal.channel_account_id.in_(visible_account_ids) if visible_account_ids else Signal.id.is_(None),
    )


def _decision_join(*columns):
    return (
        select(*columns)
        .select_from(Signal)
        .join(SignalMessage, SignalMessage.signal_id == Signal.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
    )


async def attention_counts(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None = None,
    *,
    by_agent: bool = False,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any]:
    """What waits on people: the one source for nav badges, the bell, Cockpit and agents.

    ``for_you`` (only with ``user_id``) counts open conversations where it is your
    turn; ``decisions`` counts conversations with a real awaiting decision;
    ``no_reply_suggestions`` counts the tip cards kept out of ``decisions``.
    ``by_agent`` adds ``decisions_by_agent`` keyed by the owning agent id.
    """
    decisions = int(
        (
            await session.execute(
                _decision_join(func.count(func.distinct(Signal.id))).where(
                    *_open_decision_filters(tenant_id)
                )
            )
        ).scalar_one()
        or 0
    )
    no_reply = int(
        (
            await session.execute(
                _decision_join(func.count(func.distinct(Signal.id))).where(
                    *_open_decision_filters(tenant_id, tip_cards=True)
                )
            )
        ).scalar_one()
        or 0
    )
    out: dict[str, Any] = {"decisions": decisions, "no_reply_suggestions": no_reply}

    if user_id is not None:
        stmt = select(func.count()).select_from(Signal).where(
            Signal.tenant_id == tenant_id,
            Signal.status == "open",
            _hub_predicate(user_id),
            await turn_is_mine_clause(session, tenant_id, user_id),
        )
        acl = _visibility_predicate(visible_account_ids)
        if acl is not None:
            stmt = stmt.where(acl)
        out["for_you"] = int((await session.execute(stmt)).scalar_one() or 0)

    if by_agent:
        rows = (
            await session.execute(
                _decision_join(Signal.agent_id, func.count(func.distinct(Signal.id)))
                .where(*_open_decision_filters(tenant_id), Signal.agent_id.is_not(None))
                .group_by(Signal.agent_id)
            )
        ).all()
        out["decisions_by_agent"] = {agent_id: int(n) for agent_id, n in rows}
    return out


async def nav_badge_counts(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    include_agents_attention: bool,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any]:
    """Lightweight unread/attention counts for sidebar badges (no thread payloads).

    Unassigned / all badges only count **open** hub threads (never closed,
    spam, pending, or Bin). Closed conversations clear ``has_unread`` on close.
    """
    from app.services.trash import alive

    tenant = Signal.tenant_id == tenant_id
    # Closed / spam / snoozed never inflate Unassigned or All unread badges.
    open_status = Signal.status == "open"
    unread = Signal.has_unread.is_(True)
    not_trashed = alive(Signal)
    acl = _visibility_predicate(visible_account_ids)

    async def _count(*filters) -> int:
        stmt = select(func.count()).select_from(Signal).where(tenant, not_trashed, *filters)
        if acl is not None:
            stmt = stmt.where(acl)
        return int((await session.execute(stmt)).scalar_one() or 0)

    hub_inbox = _hub_predicate(user_id)
    for_you = await for_you_clause(session, tenant_id, user_id)
    attention = await attention_counts(
        session, tenant_id, user_id, visible_account_ids=visible_account_ids
    )
    for_you_count = attention["for_you"]
    for_you_unread = await _count(open_status, unread, hub_inbox, for_you)
    unassigned_unread = await _count(open_status, unread, hub_inbox, unassigned_predicate())
    all_unread = await _count(open_status, unread, hub_inbox)

    agents_attention = attention["decisions"] if include_agents_attention else 0
    no_reply_suggestions = attention["no_reply_suggestions"] if include_agents_attention else 0

    from app.models.team import Team
    from app.services.time_items import due_for_user

    pinned_teams = (
        await session.execute(
            select(Team.id).where(Team.tenant_id == tenant_id, Team.pinned.is_(True))
        )
    ).scalars().all()
    by_team: dict[str, int] = {}
    for team_id in pinned_teams:
        by_team[str(team_id)] = await _count(
            open_status,
            hub_inbox,
            or_(
                and_(Signal.turn_kind == "team", Signal.turn_team_id == team_id),
                and_(
                    Signal.assignee_kind == "team",
                    Signal.assignee_team_id == team_id,
                    unread,
                ),
            ),
        )

    return {
        "inbox_unread": for_you_count + unassigned_unread,
        "inbox_by_queue": {
            "for_you": for_you_count,
            "for_you_unread": for_you_unread,
            "unassigned": unassigned_unread,
            "all": all_unread,
        },
        "by_team": by_team,
        "agents_attention": agents_attention,
        "no_reply_suggestions": no_reply_suggestions,
        "agenda_due": await due_for_user(session, tenant_id, user_id),
    }


def _exists_message_kind(tenant_id: UUID, kind: str):
    """EXISTS predicate: this Signal has at least one message of ``kind``."""
    return (
        select(SignalMessage.id)
        .where(
            SignalMessage.signal_id == Signal.id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == kind,
        )
        .exists()
    )


def _exists_open_decision(*, tip_cards: bool = False):
    """EXISTS predicate: this Signal has an awaiting decision (or tip card).

    Mirrors ``_open_decision_filters`` without materializing every matching
    signal id for the tenant into Python.
    """
    from app.services.automated_mail import NO_REPLY_DECISION_TITLE

    title_clause = (
        DecisionRequest.title == NO_REPLY_DECISION_TITLE
        if tip_cards
        else DecisionRequest.title != NO_REPLY_DECISION_TITLE
    )
    return (
        select(SignalMessage.id)
        .join(DecisionRequest, DecisionRequest.id == SignalMessage.decision_id)
        .where(
            SignalMessage.signal_id == Signal.id,
            Signal.channel != "assistant",
            Signal.status.notin_(("closed", "spam")),
            SignalMessage.kind == "decision_request",
            DecisionRequest.status == "awaiting_human",
            title_clause,
        )
        .exists()
    )


def _exists_outbound_message(tenant_id: UUID):
    """EXISTS predicate: this Signal has at least one outbound message."""
    return (
        select(SignalMessage.id)
        .where(
            SignalMessage.signal_id == Signal.id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.direction == "outbound",
        )
        .exists()
    )


def _needs_reply_predicate(tenant_id: UUID):
    """Open thread where the other side spoke last (or it is unread).

    "Spoke last" compares the newest inbound user message with the newest
    real outbound reply; mock/placeholder bodies do not count as a reply.
    """
    last_user = (
        select(SignalMessage.signal_id, func.max(SignalMessage.created_at).label("at"))
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "user_message",
            SignalMessage.direction == "inbound",
        )
        .group_by(SignalMessage.signal_id)
        .subquery()
    )
    last_agent = (
        select(SignalMessage.signal_id, func.max(SignalMessage.created_at).label("at"))
        .where(
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.direction == "outbound",
            # Outbound system_event = "handled outside Bokito": counts as answered.
            SignalMessage.kind.in_(("user_message", "agent_message", "system_event")),
            # Same skip as list previews: mock/placeholder bodies are not a reply.
            ~func.lower(SignalMessage.body_text).like("[mock]%"),
            ~func.lower(SignalMessage.body_text).like("i received your message about:%"),
        )
        .group_by(SignalMessage.signal_id)
        .subquery()
    )
    inbound_last = (
        select(last_user.c.signal_id)
        .select_from(last_user.outerjoin(last_agent, last_user.c.signal_id == last_agent.c.signal_id))
        .where(or_(last_agent.c.at.is_(None), last_user.c.at > last_agent.c.at))
    )
    return and_(
        Signal.status == "open",
        or_(Signal.has_unread.is_(True), Signal.id.in_(inbound_last)),
    )


def _hub_predicate(user_id: UUID, *, include_runs: bool = False):
    """Conversations in All communication.

    Customer channels, assistant chats the operator may see (not inline
    agent sessions — those live on their host thread), and agent work
    threads once a person must act on them. Agenda threads (tasks,
    appointments, repeating wakes) always show. Filtering on one agent shows
    all of that agent's threads, including its runs. Private Bokito helper
    chats (source=personal) stay in the in-app widget, not this hub.
    """
    from app.services.personal_assistant import PERSONAL_THREAD_SOURCE
    from app.services.thread_schedule import SCHEDULE_SOURCE

    clauses = [
        Signal.channel.notin_(("internal", "assistant")),
        and_(
            Signal.channel == "assistant",
            Signal.source != PERSONAL_THREAD_SOURCE,
            Signal.context_signal_id.is_(None),
            or_(Signal.owner_user_id == user_id, Signal.owner_user_id.is_(None)),
        ),
    ]
    if include_runs:
        clauses.append(Signal.channel == "internal")
    else:
        clauses.append(
            and_(
                Signal.channel == "internal",
                or_(
                    Signal.turn_kind.in_(("user", "team")),
                    Signal.source.in_(("team", SCHEDULE_SOURCE)),
                ),
            )
        )
    return or_(*clauses)


async def list_threads(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    *,
    view: str = "all_open",
    folder: str | None = None,
    channel: str | None = None,
    search: str | None = None,
    assignee_id: int | None = None,
    tag: str | None = None,
    connection_id: str | None = None,
    email_connection_id: int | None = None,
    project_id: str | None = None,
    category_id: str | None = None,
    stage: str | None = None,
    agent_id: str | None = None,
    unread: bool = False,
    needs_reply: bool = False,
    needs_decision: bool = False,
    pinned_only: bool = False,
    page: int = 1,
    per_page: int = 30,
    visible_account_ids: set[UUID] | None = None,
    team_id: str | None = None,
    scheduled_from: datetime | None = None,
    scheduled_to: datetime | None = None,
) -> dict[str, Any]:
    pinned = await _pinned_ids(session, tenant_id, user_id)
    from app.services.trash import alive

    from app.services.personal_assistant import PERSONAL_THREAD_SOURCE

    query = select(Signal).where(
        Signal.tenant_id == tenant_id,
        alive(Signal),
        Signal.source != PERSONAL_THREAD_SOURCE,
    )
    acl = _visibility_predicate(visible_account_ids)
    if acl is not None:
        query = query.where(acl)
    mine_first = None

    if team_id:
        try:
            team_uuid = UUID(team_id)
        except ValueError:
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}
        query = query.where(
            or_(
                and_(Signal.assignee_kind == "team", Signal.assignee_team_id == team_uuid),
                and_(Signal.turn_kind == "team", Signal.turn_team_id == team_uuid),
            )
        )

    if folder == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS))
    elif folder == "internal":
        query = query.where(Signal.channel == "internal")
    elif folder == "inbox":
        query = query.where(_hub_predicate(user_id, include_runs=bool(agent_id)))
    elif folder == "assistant":
        query = query.where(Signal.channel == "assistant")
        query = query.where(Signal.context_signal_id.is_(None))
        query = query.where(
            (Signal.owner_user_id == user_id) | (Signal.owner_user_id.is_(None))
        )

    if channel:
        channel_key = channel.strip().lower()
        widget_aliases = ("widget", "customer_widget", "webchat", "chat", "livechat")
        if channel_key in widget_aliases:
            query = query.where(Signal.channel.in_(widget_aliases))
        else:
            query = query.where(Signal.channel == channel)

    from app.services.communication_nav import filter_predicates

    folder_filters = filter_predicates(
        tenant_id, {"project_id": project_id, "category_id": category_id, "tag": tag, "stage": stage}
    )
    if folder_filters is None:
        return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}
    query = query.where(*folder_filters)

    if view == "all":
        # Active workload across statuses; closed and spam threads live in
        # their own views so closing a thread removes it from "All".
        query = query.where(Signal.status.notin_(("closed", "spam")))
    elif view == "all_open":
        query = query.where(Signal.status == "open")
    elif view == "for_you":
        query = query.where(
            Signal.status == "open", await for_you_clause(session, tenant_id, user_id)
        )
        mine_first = await turn_is_mine_clause(session, tenant_id, user_id)
    elif view == "unassigned":
        query = query.where(Signal.status == "open", unassigned_predicate())
    elif view == "pending":
        query = query.where(Signal.status == "pending")
    elif view == "scheduled":
        # Threads with a date: agenda items, look-agains, repeating tasks
        # (paused repeats have no next moment but still belong here).
        from app.models.trigger import Trigger

        rule_threads = select(Trigger.signal_id).where(
            Trigger.tenant_id == tenant_id,
            Trigger.signal_id.is_not(None),
            Trigger.deleted_at.is_(None),
            Trigger.kind != "webhook",
        )
        query = query.where(
            or_(Signal.next_at.is_not(None), Signal.id.in_(rule_threads)),
            Signal.status.notin_(("spam",)),
        )
    elif view == "closed":
        query = query.where(Signal.status == "closed")
    elif view == "spam":
        query = query.where(Signal.status == "spam")
    elif view == "pinned":
        if pinned:
            query = query.where(Signal.id.in_(pinned))
        else:
            query = query.where(Signal.id.is_(None))
    elif view == "awaiting_decision":
        query = query.where(_exists_open_decision())
    elif view == "updates":
        query = query.where(_exists_message_kind(tenant_id, "status_update"))
    elif view == "results":
        query = query.where(_exists_message_kind(tenant_id, "task_result"))
    elif view == "outbound":
        query = query.where(
            Signal.channel.in_(EXTERNAL_CHANNELS),
            _exists_outbound_message(tenant_id),
        )
    elif view == "external":
        query = query.where(Signal.channel.in_(EXTERNAL_CHANNELS), Signal.status == "open")
    elif view == "internal":
        query = query.where(Signal.channel == "internal")

    if assignee_id is not None:
        user_map = await _user_map(session, tenant_id)
        assignee_uuid = user_map.get(assignee_id)
        if assignee_uuid:
            query = query.where(Signal.assigned_user_id == assignee_uuid)
        else:
            query = query.where(Signal.id.is_(None))

    if connection_id:
        try:
            query = query.where(Signal.connection_id == UUID(connection_id))
        except ValueError:
            # A malformed filter must narrow to nothing, not silently widen
            # the result set to the whole inbox.
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}

    if email_connection_id is not None:
        account_id = await resolve_email_account_by_numeric_id(session, tenant_id, email_connection_id)
        if account_id:
            query = query.where(Signal.channel_account_id == account_id)
        else:
            query = query.where(Signal.id.is_(None))

    if agent_id:
        try:
            query = query.where(Signal.agent_id == UUID(agent_id))
        except ValueError:
            return {"items": [], "curPage": page, "itemsTotal": 0, "nextPage": None}

    if scheduled_from is not None:
        query = query.where(Signal.next_at >= scheduled_from)
    if scheduled_to is not None:
        query = query.where(Signal.next_at <= scheduled_to)
    if unread:
        query = query.where(Signal.has_unread.is_(True))
    if pinned_only:
        query = query.where(Signal.id.in_(pinned) if pinned else Signal.id.is_(None))
    if needs_reply:
        query = query.where(_needs_reply_predicate(tenant_id))
    if needs_decision:
        query = query.where(_exists_open_decision())

    if search:
        like = f"%{search}%"
        # Message-body predicate: on Postgres use full-text search backed by
        # the expression GIN index from schema_patch (`ix_signal_messages_fts`,
        # expression must match verbatim); SQLite (tests) falls back to ILIKE.
        bind = getattr(session, "bind", None)
        if bind is not None and bind.dialect.name == "postgresql":
            body_pred = sa_text(
                "to_tsvector('simple', coalesce(signal_messages.subject, '') || ' ' "
                "|| coalesce(signal_messages.body_text, '')) "
                "@@ plainto_tsquery('simple', :fts_query)"
            ).bindparams(fts_query=search)
        else:
            body_pred = SignalMessage.body_text.ilike(like)
        # EXISTS keeps the row set deduplicated and the planner free to use
        # the signal indexes.
        body_match = (
            select(SignalMessage.id)
            .where(
                SignalMessage.signal_id == Signal.id,
                SignalMessage.tenant_id == tenant_id,
                body_pred,
            )
            .exists()
        )
        company_match = (
            select(Contact.id)
            .where(
                Contact.id == Signal.contact_id,
                Contact.tenant_id == tenant_id,
                Contact.company.ilike(like),
            )
            .exists()
        )
        attachment_match = (
            select(SignalMessage.id)
            .where(
                SignalMessage.signal_id == Signal.id,
                SignalMessage.tenant_id == tenant_id,
                SignalMessage.attachments_json.ilike(like),
            )
            .exists()
        )
        query = query.where(
            Signal.subject.ilike(like)
            | Signal.contact_email.ilike(like)
            | Signal.contact_name.ilike(like)
            | body_match
            | company_match
            | attachment_match
        )

    count_result = await session.execute(select(func.count()).select_from(query.subquery()))
    items_total = count_result.scalar_one()

    human_first = case(
        (Signal.ai_handling_reason.in_(("handoff_requested", "escalated")), 0),
        else_=1,
    )
    if view == "scheduled":
        query = query.order_by(Signal.next_at.asc())
    elif mine_first is not None:
        # For you: a customer waiting on a person, then what waits on you now,
        # then what you merely own.
        query = query.order_by(
            human_first,
            case((mine_first, 0), else_=1),
            Signal.last_message_at.desc(),
        )
    else:
        query = query.order_by(human_first, Signal.last_message_at.desc())
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await session.execute(query)
    threads = list(result.scalars().all())
    threads.sort(key=lambda t: t.id not in pinned)

    agent_ids = {t.agent_id for t in threads if t.agent_id}
    agents_by_id: dict[UUID, Agent] = {}
    if agent_ids:
        agent_rows = await session.execute(
            select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(agent_ids))
        )
        agents_by_id = {a.id: a for a in agent_rows.scalars().all()}

    project_po_agents: dict[UUID, Agent] = {}
    unresolved_project_ids = {
        t.project_id for t in threads if t.project_id and not t.agent_id
    }
    if unresolved_project_ids:
        from app.models.project import Project

        project_result = await session.execute(
            select(Project).where(
                Project.tenant_id == tenant_id,
                Project.id.in_(unresolved_project_ids),
                Project.po_agent_id.is_not(None),
            )
        )
        projects = list(project_result.scalars().all())
        po_ids = {p.po_agent_id for p in projects if p.po_agent_id}
        if po_ids:
            po_rows = await session.execute(
                select(Agent).where(Agent.tenant_id == tenant_id, Agent.id.in_(po_ids))
            )
            po_by_id = {a.id: a for a in po_rows.scalars().all()}
            for project in projects:
                if project.po_agent_id and project.po_agent_id in po_by_id:
                    project_po_agents[project.id] = po_by_id[project.po_agent_id]

    previews = await _latest_message_previews(session, tenant_id, [t.id for t in threads])
    open_dec = (
        await _signals_with_open_decisions(
            session, tenant_id, signal_ids=[t.id for t in threads]
        )
        if threads
        else set()
    )

    from app.models.auth import Tenant
    from app.services.ai_handling import resolve_ai_handling, widget_account

    tenant = await session.get(Tenant, tenant_id)
    account_ids = {t.channel_account_id for t in threads if t.channel_account_id}
    accounts_by_id: dict[UUID, ChannelAccount] = {}
    if account_ids:
        account_rows = await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant_id,
                ChannelAccount.id.in_(account_ids),
            )
        )
        accounts_by_id = {a.id: a for a in account_rows.scalars().all()}
    widget_fallback = (
        await widget_account(session, tenant_id)
        if any(t.channel == "widget" and not t.channel_account_id for t in threads)
        else None
    )
    contact_ids = {t.contact_id for t in threads if t.contact_id}
    contacts_by_id: dict[UUID, Contact] = {}
    if contact_ids:
        contact_rows = await session.execute(
            select(Contact).where(Contact.tenant_id == tenant_id, Contact.id.in_(contact_ids))
        )
        contacts_by_id = {c.id: c for c in contact_rows.scalars().all()}
    from app.services.tickets import tickets_by_signal

    tickets = await tickets_by_signal(session, tenant_id, threads)
    from app.services.signal_tags import tags_by_signal

    tags_map = await tags_by_signal(session, [t.id for t in threads])
    from app.services.thread_schedule import rules_by_signal, schedule_payload

    rules = await rules_by_signal(session, tenant_id, [t.id for t in threads])

    items = []
    for t in threads:
        agent = agents_by_id.get(t.agent_id) if t.agent_id else None
        if not agent and t.project_id:
            agent = project_po_agents.get(t.project_id)
        preview, direction, by_agent = previews.get(t.id, ("", "", False))
        account = accounts_by_id.get(t.channel_account_id) if t.channel_account_id else None
        if account is None and t.channel == "widget":
            account = widget_fallback
        contact = contacts_by_id.get(t.contact_id) if t.contact_id else None
        handling = resolve_ai_handling(tenant, account, contact, t, agent=agent).to_payload()
        items.append(
            serialize_thread(
                t,
                is_pinned=t.id in pinned,
                user_num=user_num,
                agent=agent,
                last_preview=preview,
                last_direction=direction,
                last_by_agent=by_agent,
                has_open_decision=t.id in open_dec,
                ai_handling=handling,
                ticket=tickets.get(t.id),
                tags=tags_map.get(t.id, []),
                schedule=schedule_payload(rules.get(t.id)),
            )
        )
    next_page = page + 1 if page * per_page < items_total else None
    return {"items": items, "curPage": page, "itemsTotal": items_total, "nextPage": next_page}


async def get_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
    limit: int = 80,
    before: UUID | None = None,
) -> dict[str, Any] | None:
    """Load a thread detail with a bounded message window.

    Default returns the newest ``limit`` messages (chronological). Pass
    ``before`` (a message id) to page older history. ``has_older`` tells the
    client whether another page exists above the returned window.
    """
    result = await session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return None
    if (
        visible_account_ids is not None
        and signal.channel_account_id
        and signal.channel_account_id not in visible_account_ids
    ):
        # Hidden accounts 404 for members: existence must not leak.
        return None

    page_size = max(1, min(int(limit or 80), 200))
    pinned = await _pinned_ids(session, tenant_id, user_id)

    msg_filters: list[Any] = [
        SignalMessage.signal_id == signal_id,
        SignalMessage.tenant_id == tenant_id,
    ]
    if before is not None:
        before_row = (
            await session.execute(
                select(SignalMessage).where(
                    SignalMessage.id == before,
                    SignalMessage.signal_id == signal_id,
                    SignalMessage.tenant_id == tenant_id,
                )
            )
        ).scalar_one_or_none()
        if before_row is not None and before_row.created_at is not None:
            msg_filters.append(
                or_(
                    SignalMessage.created_at < before_row.created_at,
                    and_(
                        SignalMessage.created_at == before_row.created_at,
                        SignalMessage.id < before_row.id,
                    ),
                )
            )

    # Newest-first +1 to detect has_older, then reverse for chronological UI.
    messages_result = await session.execute(
        select(SignalMessage)
        .where(*msg_filters)
        .order_by(SignalMessage.created_at.desc(), SignalMessage.id.desc())
        .limit(page_size + 1)
    )
    newest_first = list(messages_result.scalars().all())
    has_older = len(newest_first) > page_size
    messages = list(reversed(newest_first[:page_size]))

    decision_ids = [m.decision_id for m in messages if m.decision_id]
    proposal_ids = message_proposal_ids(messages)
    decision_ids.extend(proposal_ids.values())
    bundle_ids = message_bundle_ids(messages)
    for ids in bundle_ids.values():
        decision_ids.extend(ids)
    decisions_by_id: dict[UUID, DecisionRequest] = {}
    if decision_ids:
        dr = await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id.in_(decision_ids),
                DecisionRequest.tenant_id == tenant_id,
            )
        )
        decisions_by_id = {d.id: d for d in dr.scalars().all()}
    resolver_names = await _user_display_names(
        session,
        [
            d.resolved_by_user_id
            for did in proposal_ids.values()
            if (d := decisions_by_id.get(did)) and d.resolved_by_user_id
        ],
    )

    # Events in the same time window as the message page (plus any events
    # after the newest message when this is the live tail). Cap so a noisy
    # agent does not ship hundreds of pills with the first paint.
    EVENT_PAGE_CAP = 100
    event_filters: list[Any] = [
        SignalEvent.signal_id == signal_id,
        SignalEvent.tenant_id == tenant_id,
    ]
    if messages:
        oldest_at = messages[0].created_at
        newest_at = messages[-1].created_at
        if before is not None:
            # Older page: only events that fall inside this page's span.
            event_filters.append(SignalEvent.created_at >= oldest_at)
            if newest_at is not None:
                event_filters.append(SignalEvent.created_at <= newest_at)
        elif oldest_at is not None:
            # Live tail: drop ancient events before the window.
            event_filters.append(SignalEvent.created_at >= oldest_at)
    events_result = await session.execute(
        select(SignalEvent)
        .where(*event_filters)
        .order_by(SignalEvent.created_at.desc(), SignalEvent.id.desc())
        .limit(EVENT_PAGE_CAP + 1)
    )
    newest_events = list(events_result.scalars().all())
    events = list(reversed(newest_events[:EVENT_PAGE_CAP]))
    rev_map = {v: k for k, v in (await _user_map(session, tenant_id)).items()}
    agent = await _resolve_thread_agent(session, tenant_id, signal, messages)

    # Caller's own feedback per message so thumbs state survives reloads.
    from app.models.learning import Feedback

    feedback_by_subject: dict[str, Feedback] = {}
    if messages:
        fb_result = await session.execute(
            select(Feedback).where(
                Feedback.tenant_id == tenant_id,
                Feedback.user_id == user_id,
                Feedback.subject_type == "message",
                Feedback.subject_id.in_([str(m.id) for m in messages]),
            )
        )
        feedback_by_subject = {f.subject_id: f for f in fb_result.scalars().all()}

    # Email needs HTML in the window (LazyEmailHtmlFrame). Chat / assistant /
    # WhatsApp render plain text; agent traces load on expand via get_message.
    include_html = (signal.channel or "").lower() == "email"
    serialized_messages = []
    for m in messages:
        proposal_decision = decisions_by_id.get(proposal_ids[m.id]) if m.id in proposal_ids else None
        row = serialize_message(
            m,
            decision=decisions_by_id.get(m.decision_id) if m.decision_id else None,
            include_html=include_html,
            include_trace=False,
            channel=signal.channel,
            proposal_decision=proposal_decision,
            proposal_resolved_by=(
                resolver_names.get(proposal_decision.resolved_by_user_id)
                if proposal_decision and proposal_decision.resolved_by_user_id
                else None
            ),
            bundle_decisions=[
                decisions_by_id[did] for did in bundle_ids.get(m.id, []) if did in decisions_by_id
            ],
        )
        fb = feedback_by_subject.get(str(m.id))
        if fb:
            row["my_feedback"] = {"score": fb.score, "sentiment": fb.sentiment}
        serialized_messages.append(row)

    # Inline agent sessions anchored on this thread (active + closed).
    from app.services.agent_sessions import list_sessions

    sessions = [] if signal.channel == "assistant" else await list_sessions(
        session, tenant_id, signal_id
    )

    # End-customer satisfaction rating on the conversation (widget CSAT).
    csat_result = await session.execute(
        select(Feedback)
        .where(
            Feedback.tenant_id == tenant_id,
            Feedback.subject_type == "signal",
            Feedback.subject_id == str(signal_id),
            Feedback.score.is_not(None),
        )
        .order_by(Feedback.created_at.desc())
        .limit(1)
    )
    csat_fb = csat_result.scalar_one_or_none()
    csat = (
        {
            "score": csat_fb.score,
            "comment": csat_fb.comment or "",
            "created_at": csat_fb.created_at.isoformat(),
        }
        if csat_fb
        else None
    )

    oldest_id = str(messages[0].id) if messages else None

    from app.models.auth import Tenant
    from app.services.ai_handling import resolve_for_signal

    tenant = await session.get(Tenant, tenant_id)
    handling = (await resolve_for_signal(session, tenant, signal)).to_payload()
    from app.services import ai_handling as handling_svc
    from app.services.signal_tags import signal_tag_names
    from app.services.tickets import ticket_payload

    thread_tags = await signal_tag_names(session, signal.id)
    routing_policy = (await handling_svc.routing_for_signal(session, tenant, signal)).effective
    from app.services.ownership import human_owner_payload
    from app.services.thread_schedule import rules_by_signal, schedule_payload

    return {
        "thread": serialize_thread(
            signal,
            is_pinned=signal_id in pinned,
            agent=agent,
            has_open_decision=await _signal_has_open_decision(session, tenant_id, signal_id),
            ai_handling=handling,
            ticket=await ticket_payload(session, signal),
            tags=thread_tags,
            schedule=schedule_payload(
                (await rules_by_signal(session, tenant_id, [signal.id])).get(signal.id)
            ),
        ),
        # Channel routing policy for the composer (send split at "ask",
        # "Send and close" default) and the last person/team that handled it.
        "routing_policy": routing_policy if not is_internal_channel(signal.channel) else None,
        "last_human_owner": human_owner_payload(signal),
        "messages": serialized_messages,
        "events": [serialize_event(e, user_num_map=rev_map) for e in events],
        "sessions": sessions,
        "csat": csat,
        "has_older": has_older,
        "oldest_message_id": oldest_id,
        # Where else this person is talking to us (WhatsApp after email, a
        # second mailbox): the thread banner and the contact panel use it.
        "related_conversations": await _related_conversations(session, signal),
    }


async def _related_conversations(session: AsyncSession, signal: Signal) -> list[dict[str, Any]]:
    if is_internal_channel(signal.channel) or signal.channel == "assistant":
        return []
    from app.services.related_conversations import related_conversations

    try:
        return await related_conversations(session, signal)
    except Exception:  # noqa: BLE001 — a sidebar hint must never break the thread
        logger.debug("related_conversations failed for %s", signal.id, exc_info=True)
        return []


async def get_message(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    message_id: UUID,
    *,
    visible_account_ids: set[UUID] | None = None,
) -> dict[str, Any] | None:
    """Full message payload (HTML + agent_trace) for lazy expand on the timeline."""
    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not signal:
        return None
    if (
        visible_account_ids is not None
        and signal.channel_account_id
        and signal.channel_account_id not in visible_account_ids
    ):
        return None
    message = (
        await session.execute(
            select(SignalMessage).where(
                SignalMessage.id == message_id,
                SignalMessage.signal_id == signal_id,
                SignalMessage.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not message:
        return None
    decision = None
    if message.decision_id:
        decision = await session.get(DecisionRequest, message.decision_id)
        if decision and decision.tenant_id != tenant_id:
            decision = None
    proposal_decision = None
    proposal_id = message_proposal_ids([message]).get(message.id)
    if proposal_id:
        proposal_decision = await session.get(DecisionRequest, proposal_id)
        if proposal_decision and proposal_decision.tenant_id != tenant_id:
            proposal_decision = None
    resolver_names = await _user_display_names(
        session, [proposal_decision.resolved_by_user_id] if proposal_decision else []
    )
    bundle_decisions: list[DecisionRequest] = []
    bundle_ids = message_bundle_ids([message]).get(message.id, [])
    if bundle_ids:
        bundle_decisions = list(
            (
                await session.execute(
                    select(DecisionRequest).where(
                        DecisionRequest.id.in_(bundle_ids), DecisionRequest.tenant_id == tenant_id
                    )
                )
            ).scalars().all()
        )
    return serialize_message(
        message,
        decision=decision,
        include_html=True,
        include_trace=True,
        channel=signal.channel,
        proposal_decision=proposal_decision,
        proposal_resolved_by=(
            resolver_names.get(proposal_decision.resolved_by_user_id)
            if proposal_decision and proposal_decision.resolved_by_user_id
            else None
        ),
        bundle_decisions=bundle_decisions,
    )


async def update_note(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    message_id: UUID,
    *,
    body_text: str,
    author_user_id: UUID | None = None,
    author_name: str = "",
) -> dict[str, Any] | None:
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return None
    prev_mentions = {int(num) for _, num in MENTION_PATTERN.findall(message.body_text or "")}
    message.body_text = body_text
    message.body_preview = clean_message_preview(body_text, limit=200)
    # Notes are created with a body_html mirror (see reply_to_thread); keep it
    # in sync or the timeline keeps rendering the stale HTML after an edit.
    message.body_html = f"<p>{body_text}</p>"
    session.add(message)
    await session.commit()
    # A mention added during the edit must still ping the teammate; mentions
    # that were already in the note stay silent (no duplicate notifications).
    new_mentions = {int(num) for _, num in MENTION_PATTERN.findall(body_text or "")}
    added = new_mentions - prev_mentions
    if added:
        signal = await _get_signal_row(session, tenant_id, signal_id)
        if signal:
            added_only = MENTION_PATTERN.sub(
                lambda m: m.group(0) if int(m.group(2)) in added else f"@{m.group(1)}",
                body_text or "",
            )
            await notify_mentions(
                session,
                tenant_id,
                signal,
                body_text=added_only,
                author_user_id=author_user_id,
                author_name=author_name,
            )
    return serialize_message(message)


async def delete_note(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    message_id: UUID,
) -> bool:
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return False
    await session.delete(message)
    await session.commit()
    return True


async def list_notes(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
) -> list[dict[str, Any]]:
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.kind == "internal_note",
        )
        .order_by(SignalMessage.created_at)
    )
    return [serialize_message(m) for m in result.scalars().all()]


async def _get_signal_row(
    session: AsyncSession, tenant_id: UUID, signal_id: UUID, *, include_deleted: bool = False
) -> Signal | None:
    query = select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
    if not include_deleted:
        from app.services.trash import alive

        query = query.where(alive(Signal))
    result = await session.execute(query)
    return result.scalar_one_or_none()


async def patch_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    status: str | None = None,
    assigned_to_user_id: int | None = None,
    tags: list[str] | None = None,
    priority: str | None = None,
    project_id: UUID | None = None,
    project_id_set: bool = False,
    assignee: dict[str, Any] | None = None,
    channel_account_id: UUID | None = None,
    channel_account_id_set: bool = False,
    actor_role: str = "member",
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    before_status = signal.status
    before_assignee = signal.assigned_user_id
    before_owner = owner_payload(signal)
    if channel_account_id_set:
        if channel_account_id is None:
            raise HTTPException(status_code=422, detail="channel_account_id is required")
        await _rebind_email_account_for_reply(
            session,
            signal,
            channel_account_id=channel_account_id,
            user_id=user_id,
            actor_role=actor_role,
        )
    if status is not None:
        signal.status = status
    newly_assigned: UUID | None = None
    if assignee is None and assigned_to_user_id is not None:
        # Shorthand from the person picker: 0 clears to the channel's owner team.
        assignee = (
            {"kind": "user", "id": assigned_to_user_id}
            if assigned_to_user_id
            else {"kind": "team", "id": None}
        )
    if assignee is not None:
        kind = str(assignee.get("kind") or "")
        try:
            owner_id = await resolve_assignee(session, tenant_id, signal, kind, assignee.get("id"))
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if kind == "user" and owner_id != signal.assigned_user_id and owner_id != user_id:
            newly_assigned = owner_id
        set_owner(signal, kind, owner_id, by_user_id=user_id)
    if tags is not None:
        from app.services.signal_tags import set_signal_tags

        # Operator-typed tags join the tenant vocabulary, so the sidebar,
        # settings, and agent tagging all see the same list.
        tags = await set_signal_tags(session, tenant_id, signal.id, tags, user_id=user_id)
    if priority is not None:
        signal.priority = priority
    if project_id_set:
        if project_id is not None:
            from app.models.project import Project

            project_result = await session.execute(
                select(Project).where(Project.id == project_id, Project.tenant_id == tenant_id)
            )
            if not project_result.scalar_one_or_none():
                raise HTTPException(status_code=404, detail="Project not found")
        signal.project_id = project_id
    signal.updated_at = datetime.utcnow()
    if signal.status != before_status and signal.status in {"pending", "closed", "spam"}:
        parked = {
            "pending": "human_snoozed",
            "closed": "human_closed",
            "spam": "human_spam",
        }[signal.status]
        await _defer_open_reply_suggestions(session, tenant_id, signal_id, reason=parked)
        # Closed / spam must not keep an unread bit that could inflate badges.
        if signal.status in {"closed", "spam"}:
            signal.has_unread = False
    from app.services import ai_handling as handling_svc

    if signal.status != before_status:
        handling_svc.on_status_change(session, signal, actor_id=str(user_id))
        if signal.status == "closed":
            from app.services.tickets import settle_ticket_on_close

            await settle_ticket_on_close(session, signal, actor_type="user", actor_id=str(user_id))
    handling_svc.on_assignment_change(
        session,
        signal,
        before_assignee=before_assignee,
        before_kind=before_owner["kind"],
        actor_id=str(user_id),
    )
    owner_changed = owner_payload(signal) != before_owner
    session.add(signal)
    self_pick = (
        owner_changed
        and before_owner["kind"] == "team"
        and signal.assignee_kind == "user"
        and signal.assigned_user_id == user_id
    )
    if self_pick:
        before_team = UUID(before_owner["team_id"]) if before_owner.get("team_id") else None
        session.add(await picked_up_event(session, signal, user_id, before_team, via="pick_up"))
    elif owner_changed:
        session.add(
            SignalEvent(
                signal_id=signal_id,
                tenant_id=tenant_id,
                event_type="assigned",
                actor_type="user",
                actor_id=str(user_id),
                payload_json=json.dumps({"before": before_owner, "after": owner_payload(signal)}),
            )
        )
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="thread_updated",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps(
                {
                    "status": status,
                    "priority": priority,
                    "project_id": str(project_id) if project_id else None,
                    "assigned_to": assigned_to_user_id,
                    "tags": tags,
                }
            ),
        )
    )
    # Govern audit only for the mutations that matter (status / assignee) —
    # tag/priority tweaks stay thread-timeline-only to avoid audit noise.
    if signal.status != before_status or owner_changed:
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action="signal:updated",
            actor_type="user",
            actor_id=user_id,
            resource_type="signal",
            resource_id=signal_id,
            summary=(signal.subject or "")[:120],
            before={"status": before_status, "owner": before_owner},
            after={"status": signal.status, "owner": owner_payload(signal)},
            commit=False,
        )
    await session.commit()
    await session.refresh(signal)
    if owner_changed and signal.assignee_kind == "agent":
        from app.workers.tasks import assignment_should_wake_agent, enqueue_signal_processing

        if await assignment_should_wake_agent(session, signal):
            await enqueue_signal_processing(str(tenant_id), str(signal.id))
    from app.models.auth import Tenant

    handling = (
        await handling_svc.resolve_for_signal(session, await session.get(Tenant, tenant_id), signal)
    ).to_payload()
    await publish_thread_update(signal, ai_handling=handling)
    if signal.status == "closed" and before_status != "closed":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    handover = str((assignee or {}).get("message") or "").strip()
    if owner_changed and handover:
        # The handover note mentions the new owner, so the mention path notifies
        # the person, runs the agent, or follows the team's pickup.
        markup = await _owner_mention_markup(session, signal)
        await reply_to_thread(
            session,
            tenant_id,
            user_id,
            user_num,
            signal_id,
            body_text=f"{markup} {handover}".strip(),
            direction="internal",
            kind="internal_note",
            actor_role=actor_role,
        )
        await session.refresh(signal)
    elif newly_assigned:
        await _notify_assignment(session, tenant_id, signal, assignee_id=newly_assigned, actor_id=user_id)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    from app.services.signal_tags import signal_tag_names
    from app.services.tickets import ticket_payload

    return serialize_thread(
        signal,
        is_pinned=signal_id in pinned,
        user_num=user_num,
        ai_handling=handling,
        ticket=await ticket_payload(session, signal),
        tags=await signal_tag_names(session, signal.id),
    )


async def _owner_mention_markup(session: AsyncSession, signal: Signal) -> str:
    """``@[Name](kind:id)`` for the conversation's current owner."""
    from app.models.agent import Agent
    from app.models.team import Team

    if signal.assignee_kind == "user" and signal.assigned_user_id:
        user = await session.get(User, signal.assigned_user_id)
        name = (user.display_name or user.email) if user else "Teammate"
        return f"@[{name}](user:{user_numeric_id(signal.assigned_user_id)})"
    if signal.assignee_kind == "agent" and signal.agent_id:
        agent = await session.get(Agent, signal.agent_id)
        return f"@[{agent.name if agent else 'Agent'}](agent:{signal.agent_id})"
    if signal.assignee_team_id:
        team = await session.get(Team, signal.assignee_team_id)
        return f"@[{team.name if team else 'Team'}](team:{signal.assignee_team_id})"
    return ""


async def _notify_assignment(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    assignee_id: UUID,
    actor_id: UUID,
) -> None:
    """Tell a teammate a conversation is theirs now (tier 1)."""
    from app.services.notify import TIER_NOW, notify

    actor_result = await session.execute(select(User).where(User.id == actor_id))
    actor = actor_result.scalar_one_or_none()
    actor_name = (actor.display_name or actor.email) if actor else "A teammate"
    await notify(
        session,
        tenant_id,
        kind="assignment",
        recipients=[assignee_id],
        title=f"{actor_name} assigned {signal.subject or 'a conversation'} to you",
        body=(signal.summary or "")[:300],
        tier=TIER_NOW,
        category="assigned-to-me",
        signal_id=signal.id,
    )


async def set_read(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    read: bool,
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    signal.has_unread = not read
    session.add(signal)
    if read:
        from app.services.notify import mark_conversation_read

        await mark_conversation_read(session, tenant_id, user_id, signal_id)
    await session.commit()
    await session.refresh(signal)
    await publish_thread_update(signal)
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return serialize_thread(signal, is_pinned=signal_id in pinned, user_num=user_num)


BULK_ACTIONS = ("close", "reopen", "spam", "read", "unread", "assign", "trash")


async def bulk_update_threads(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    signal_ids: list[UUID],
    action: str,
    assignee_id: int | None = None,
) -> dict[str, Any]:
    """Apply one operator action to many threads at once (inbox bulk bar)."""
    if action not in BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown bulk action: {action}")
    assignee_uuid: UUID | None = None
    if action == "assign":
        user_map = await _user_map(session, tenant_id)
        assignee_uuid = user_map.get(assignee_id) if assignee_id else None
        if not assignee_uuid:
            raise HTTPException(status_code=404, detail="Assignee not found")

    result = await session.execute(
        select(Signal).where(
            Signal.tenant_id == tenant_id,
            Signal.id.in_(signal_ids),
            Signal.deleted_at.is_(None),
        )
    )
    signals = list(result.scalars().all())
    now = datetime.utcnow()
    before_states = {
        str(s.id): {"status": s.status, "assigned_user_id": str(s.assigned_user_id or "")}
        for s in signals
    }
    from app.services import ai_handling as handling_svc

    if action == "trash":
        from app.services.audit import record_audit
        from app.services.trash import load_tenant, move_to_bin

        tenant = await load_tenant(session, tenant_id)
        for signal in signals:
            await move_to_bin(
                session,
                tenant,
                resource_type="conversation",
                row=signal,
                user_id=user_id,
                title=signal.subject,
                commit=False,
            )
        if signals:
            await record_audit(
                session,
                tenant_id,
                action="signal:bulk_trash",
                actor_type="user",
                actor_id=user_id,
                resource_type="signal",
                resource_id=";".join(str(s.id) for s in signals[:50]),
                summary=f"Bulk trash on {len(signals)} thread(s)",
                before=before_states,
                after=None,
                commit=False,
            )
        await session.commit()
        for signal in signals:
            await publish_thread_update(signal)
        return {"updated": len(signals), "action": action}

    for signal in signals:
        before_assignee = signal.assigned_user_id
        if action == "close":
            signal.status = "closed"
            signal.has_unread = False
        elif action == "reopen":
            signal.status = "open"
        elif action == "spam":
            signal.status = "spam"
            signal.has_unread = False
        elif action == "read":
            signal.has_unread = False
        elif action == "unread":
            signal.has_unread = True
        elif action == "assign":
            signal.assigned_user_id = assignee_uuid
        if action == "close":
            handling_svc.on_status_change(session, signal, actor_id=str(user_id))
            from app.services.tickets import settle_ticket_on_close

            await settle_ticket_on_close(session, signal, actor_type="user", actor_id=str(user_id))
        elif action == "assign":
            handling_svc.on_assignment_change(
                session, signal, before_assignee=before_assignee, actor_id=str(user_id)
            )
        signal.updated_at = now
        session.add(signal)
        if action in ("close", "spam"):
            # A closed/spam thread must not keep a pending reply card in the
            # decision queue: nobody is going to send that draft anymore.
            await _defer_open_reply_suggestions(
                session, tenant_id, signal.id, reason="thread_closed"
            )
        if action in ("close", "reopen", "spam", "assign"):
            event_payload: dict[str, Any] = {"bulk": action}
            if action == "assign" and assignee_id is not None:
                # The timeline chip names the assignee from this field.
                event_payload["assigned_to"] = assignee_id
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=tenant_id,
                    event_type="thread_updated",
                    actor_type="user",
                    actor_id=str(user_id),
                    payload_json=json.dumps(event_payload),
                )
            )
    # One audit event per bulk action with the before-states; mark-read noise
    # (read/unread) is intentionally excluded from the govern audit.
    if signals and action in ("close", "reopen", "spam", "assign"):
        from app.services.audit import record_audit

        await record_audit(
            session,
            tenant_id,
            action=f"signal:bulk_{action}",
            actor_type="user",
            actor_id=user_id,
            resource_type="signal",
            resource_id=";".join(str(s.id) for s in signals[:50]),
            summary=f"Bulk {action} on {len(signals)} thread(s)",
            before=before_states,
            after={"assignee_id": assignee_id} if action == "assign" else None,
            commit=False,
        )
    await session.commit()
    for signal in signals:
        await publish_thread_update(signal)
    if action == "close":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        for signal in signals:
            if before_states[str(signal.id)]["status"] != "closed":
                await emit_webhook_event(
                    session, tenant_id, "signal.closed", signal_event_data(signal)
                )
    return {"updated": len(signals), "action": action}


async def delete_thread(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    user_id: UUID | None = None,
    permanent: bool = False,
    commit: bool = True,
) -> bool:
    signal = await _get_signal_row(session, tenant_id, signal_id, include_deleted=permanent)
    if not signal:
        return False
    if not permanent:
        from app.services.trash import load_tenant, move_to_bin

        tenant = await load_tenant(session, tenant_id)
        await move_to_bin(
            session,
            tenant,
            resource_type="conversation",
            row=signal,
            user_id=user_id,
            title=signal.subject,
            commit=commit,
        )
        return True
    subject = signal.subject
    for model in (SignalMessage, SignalEvent, SignalThreadPin):
        rows = await session.execute(select(model).where(model.signal_id == signal_id))
        for row in rows.scalars().all():
            await session.delete(row)

    # Clean up remaining FK references so Postgres does not reject the delete.
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import update as sa_update

    from app.models.orchestration import AgentTask
    from app.models.outcome import OperationalOutcome
    from app.models.platform_change import PlatformChange
    from app.models.trigger import Trigger

    # Decisions live inside the thread and are deleted with it; platform
    # changes keep their own record but lose the decision link.
    decision_ids = (
        (await session.execute(select(DecisionRequest.id).where(DecisionRequest.signal_id == signal_id)))
        .scalars()
        .all()
    )
    if decision_ids:
        await session.execute(
            sa_update(PlatformChange)
            .where(PlatformChange.decision_id.in_(decision_ids))  # type: ignore[attr-defined]
            .values(decision_id=None)
        )
        await session.execute(sa_delete(DecisionRequest).where(DecisionRequest.id.in_(decision_ids)))  # type: ignore[attr-defined]

    # Tasks, triggers, and outcomes outlive the thread; detach the reference.
    for ref_model in (AgentTask, Trigger, OperationalOutcome):
        await session.execute(
            sa_update(ref_model).where(ref_model.signal_id == signal_id).values(signal_id=None)
        )

    await session.delete(signal)
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="signal:deleted",
        actor_type="user" if user_id else "system",
        actor_id=user_id or "",
        resource_type="signal",
        resource_id=signal_id,
        summary=(subject or "")[:120],
        commit=False,
    )
    if commit:
        await session.commit()
    return True


REPLY_SUGGESTION_TITLES = ("Suggested reply", "Reply to customer message")

# Why an open reply suggestion was set aside (stored in ``chosen_option_id``
# on a deferred DecisionRequest; the card renders a matching label).
DEFER_HUMAN_REPLIED = "human_replied"
DEFER_SUPERSEDED_BY_INBOUND = "superseded_by_inbound"
DEFER_SUPERSEDED_BY_EXTERNAL_REPLY = "superseded_by_external_reply"
DEFER_SIBLING_THREAD = "sibling_thread"
DEFER_HANDLED_EXTERNALLY = "handled_externally"


async def _defer_open_reply_suggestions(
    session: AsyncSession,
    tenant_id: UUID,
    signal_id: UUID,
    *,
    reason: str = DEFER_HUMAN_REPLIED,
    link_signal_id: UUID | None = None,
) -> int:
    """Set aside leftover 'Suggested reply' cards that no longer fit the thread.

    Runs when a human answered, when the contact wrote again (the draft no
    longer answers the latest message), when a colleague's reply from their
    own mailbox was logged, or when a newer conversation with the same person
    carries the live proposal. Only reply-suggestion cards are deferred;
    platform-change reviews and other awaiting_human decisions stay open.
    Returns how many cards were deferred.
    """
    result = await session.execute(
        select(DecisionRequest).where(
            DecisionRequest.tenant_id == tenant_id,
            DecisionRequest.signal_id == signal_id,
            DecisionRequest.status == "awaiting_human",
            DecisionRequest.platform_change_id.is_(None),
            DecisionRequest.title.in_(REPLY_SUGGESTION_TITLES),
        )
    )
    now = datetime.utcnow()
    count = 0
    for decision in result.scalars().all():
        count += 1
        decision.status = "deferred"
        decision.resolved_at = now
        decision.chosen_option_id = reason
        if link_signal_id and decision.message_id:
            card = await session.get(SignalMessage, decision.message_id)
            if card is not None:
                try:
                    meta = json.loads(card.metadata_json or "{}")
                except json.JSONDecodeError:
                    meta = {}
                if not isinstance(meta, dict):
                    meta = {}
                meta["superseded_by_signal_id"] = str(link_signal_id)
                card.metadata_json = json.dumps(meta)
                session.add(card)
        session.add(decision)
        if decision.notification_id:
            # Clear the paired bell item too: the card no longer needs anyone.
            notif = (
                await session.execute(
                    select(Notification).where(Notification.id == decision.notification_id)
                )
            ).scalar_one_or_none()
            if notif and notif.status == "unread":
                notif.status = "read"
                session.add(notif)
    return count


async def _rebind_email_account_for_reply(
    session: AsyncSession,
    signal: Signal,
    *,
    channel_account_id: UUID,
    user_id: UUID,
    actor_role: str,
) -> None:
    """Bind an email thread to a chosen mailbox before outbound delivery.

    Cross-channel hops (WhatsApp/widget) are refused. Visibility and send
    capability are enforced so members cannot escape ACL via reply.
    """
    from app.services.channel_registry import account_can_send
    from app.services.channel_access import can_handle_account

    if signal.channel != "email":
        raise HTTPException(
            status_code=400,
            detail="channel_account_id is only valid on email threads",
        )

    result = await session.execute(
        select(ChannelAccount).where(
            ChannelAccount.id == channel_account_id,
            ChannelAccount.tenant_id == signal.tenant_id,
        )
    )
    account = result.scalar_one_or_none()
    if account is None or not await can_handle_account(
        session, account, user_id=user_id, role=actor_role
    ):
        raise HTTPException(status_code=404, detail="Channel not found")
    if account.channel != "email":
        raise HTTPException(status_code=400, detail="Selected channel is not an email mailbox")
    if not account.is_enabled or not account_can_send(account):
        raise HTTPException(status_code=409, detail="Selected mailbox cannot send")

    if signal.channel_account_id != account.id:
        signal.channel_account_id = account.id
        session.add(signal)


async def reply_to_thread(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    user_num: int,
    signal_id: UUID,
    *,
    body_text: str,
    body_html: str | None = None,
    action: str = "send",
    direction: str = "outbound",
    kind: str = "user_message",
    attachments: list[dict] | None = None,
    snooze_minutes: int | None = None,
    cc: str | None = None,
    bcc: str | None = None,
    send_after_seconds: int | None = None,
    channel_account_id: UUID | None = None,
    actor_role: str = "member",
    to: str | None = None,
    reply_mode: str = "reply",
    source_message_id: UUID | None = None,
    subject: str | None = None,
    quoted_html: str | None = None,
    handback: bool | None = None,
    keep_open: bool = False,
) -> dict[str, Any] | None:
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None

    routing_policy = None
    if direction == "outbound":
        from app.models.auth import Tenant
        from app.services import ai_handling as handling_svc

        tenant = await session.get(Tenant, tenant_id)
        routing_policy = await handling_svc.routing_for_signal(session, tenant, signal)
        if (
            action == "send"
            and not keep_open
            and routing_policy.effective["close_after_human_reply"]
        ):
            # Channel policy: a plain send closes the conversation; a new
            # customer message reopens it. The dashboard composer passes
            # keep_open when it closes through its own flow or when the
            # sender picks "send and keep open".
            action = "send_and_close"

    if channel_account_id is not None and direction == "outbound":
        await _rebind_email_account_for_reply(
            session,
            signal,
            channel_account_id=channel_account_id,
            user_id=user_id,
            actor_role=actor_role,
        )

    now = datetime.utcnow()
    # Soft undo / scheduled send: persist the message without delivering it;
    # the scheduler tick delivers once `send_after` passes, and the cancel
    # endpoint can remove it before that.
    scheduled = bool(send_after_seconds and send_after_seconds > 0) and direction == "outbound"
    # Forward goes to a fresh recipient: skip In-Reply-To / Graph reply
    # threading so the mail arrives as its own message with our subject.
    is_forward = reply_mode == "forward"
    to_override = (to or "").strip() or None
    subject_override = (subject or "").strip() or None
    send_status = None
    delivered_from = ""
    delivered_to = ""
    provider_message_id = ""
    if scheduled:
        send_status = "scheduled"
    elif direction == "outbound":
        from app.channels import deliver_outbound
        from app.services.signatures import resolve_from_display_name, resolve_signature_html

        signature_html = await resolve_signature_html(
            session,
            tenant_id,
            send_as="user",
            user_id=user_id,
            channel_account_id=signal.channel_account_id,
        )
        from_display_name = await resolve_from_display_name(
            session, tenant_id, send_as="user", user_id=user_id
        )
        delivery = await deliver_outbound(
            session,
            signal,
            body_text=body_text,
            body_html=body_html,
            subject=subject_override or "",
            to_address=to_override,
            cc=cc,
            bcc=bcc,
            attachments=attachments,
            signature_html=signature_html,
            from_display_name=from_display_name,
            quoted_html=quoted_html,
            suppress_threading=is_forward,
        )
        send_status = delivery.status
        if send_status == "skipped":
            send_status = "sent"
        if delivery.body_html:
            body_html = delivery.body_html
        delivered_from = delivery.from_address
        delivered_to = delivery.to_address
        provider_message_id = delivery.provider_message_id
    message_meta: dict[str, Any] = {}
    if cc:
        message_meta["cc"] = cc
    if bcc:
        message_meta["bcc"] = bcc
    if reply_mode and reply_mode != "reply":
        message_meta["reply_mode"] = reply_mode
    if source_message_id:
        message_meta["source_message_id"] = str(source_message_id)
    if scheduled:
        # The flush tick needs the full send intent to deliver faithfully.
        if to_override:
            message_meta["to"] = to_override
        if subject_override:
            message_meta["subject"] = subject_override
        if quoted_html:
            message_meta["quoted_html"] = quoted_html
    message = SignalMessage(
        signal_id=signal_id,
        tenant_id=tenant_id,
        kind=kind if direction == "internal" else "user_message",
        direction=direction,
        role="user" if direction != "internal" else "system",
        author_user_id=user_id,
        from_address=delivered_from,
        to_addresses=delivered_to or to_override or signal.contact_email,
        external_id=provider_message_id,
        subject=subject_override or signal.subject,
        body_text=body_text,
        body_preview=clean_message_preview(body_text, limit=200),
        body_html=body_html or f"<p>{body_text}</p>",
        attachments_json=json.dumps(attachments or []),
        metadata_json=json.dumps(message_meta) if message_meta else "{}",
        send_status=send_status,
        send_after=(now + timedelta(seconds=send_after_seconds)) if scheduled else None,
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    if direction == "outbound":
        signal.has_unread = False
    picked = False
    if direction == "outbound":
        from app.services.handover import apply_after_human_reply

        await _defer_open_reply_suggestions(session, tenant_id, signal_id)
        settled = await apply_after_human_reply(
            session, None, signal, user_id, handback=handback, via="reply"
        )
        picked = bool(settled.get("owner_changed"))
    if action == "send_and_close":
        from app.services.ai_handling import on_status_change

        signal.status = "closed"
        signal.has_unread = False
        on_status_change(session, signal, actor_id=str(user_id))
        from app.services.tickets import settle_ticket_on_close

        await settle_ticket_on_close(session, signal, actor_type="user", actor_id=str(user_id))
    elif action == "send_and_pending":
        # No park: the thread stays open and visible; a wait time becomes
        # its date, so it comes back unread when the customer stays quiet.
        if signal.status == "pending":
            signal.status = "open"
        signal.has_unread = True
        if snooze_minutes and snooze_minutes > 0:
            signal.next_at = datetime.utcnow() + timedelta(minutes=int(snooze_minutes))
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="reply_sent" if direction == "outbound" else "note_added",
            actor_type="user",
            actor_id=str(user_id),
            payload_json=json.dumps({"action": action}),
        )
    )
    await session.commit()
    await session.refresh(message)
    await publish_signal_message(signal, message)
    if picked or action in ("send_and_close", "send_and_pending"):
        # Status or owner changed alongside the reply; widget conversations also need
        # the visitor-safe status event (e.g. to show the CSAT prompt).
        await publish_thread_update(signal)
    if action == "send_and_close":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    # @mentions in replies and internal notes notify the mentioned teammates.
    author_result = await session.execute(select(User).where(User.id == user_id))
    author = author_result.scalar_one_or_none()
    author_name = (author.display_name or author.email) if author else ""
    await notify_mentions(
        session,
        tenant_id,
        signal,
        body_text=body_text,
        author_user_id=user_id,
        author_name=author_name,
    )
    if not scheduled:
        from app.services.thread_dispatch import dispatch_mentions

        await dispatch_mentions(
            session,
            tenant_id,
            signal,
            body_text=body_text,
            author_user_id=user_id,
            author_name=author_name,
            user_role=actor_role,
        )
    # Internal agent threads are two-way chats: when an operator posts a reply
    # (not an internal note), run the thread's agent in the background so Send
    # returns immediately. Deltas stream via gateway; the final message lands
    # through append_signal_chat_message. Under mock/test execution await
    # inline — background sessions cannot see the in-memory SQLite fixture.
    from app.services.ai_handling import is_held

    if direction == "outbound" and signal.channel == "internal" and not is_held(signal) and not scheduled:
        from app.config import get_settings

        if get_settings().bokito_mock_execution:
            await _generate_agent_reply(
                session,
                tenant_id,
                user_id,
                signal,
                attachments=list(attachments) if attachments else None,
            )
        else:
            _schedule_agent_reply(
                tenant_id,
                user_id,
                signal.id,
                attachments=list(attachments) if attachments else None,
            )
    return serialize_message(message)


HANDLED_EXTERNALLY_CHANNELS = ("phone", "whatsapp", "email", "other")

_HANDLED_EXTERNALLY_TEXT = {
    "en": {
        "phone": "Handled by phone by {name}",
        "whatsapp": "Handled via WhatsApp by {name}",
        "email": "Handled by email by {name}",
        "other": "Handled outside Bokito by {name}",
    },
    "nl": {
        "phone": "Afgehandeld via telefoon door {name}",
        "whatsapp": "Afgehandeld via WhatsApp door {name}",
        "email": "Afgehandeld via e-mail door {name}",
        "other": "Afgehandeld buiten Bokito door {name}",
    },
}


def handled_externally_text(channel: str, name: str, *, language: str = "") -> str:
    lang = "nl" if str(language or "").lower().startswith("nl") else "en"
    key = channel if channel in HANDLED_EXTERNALLY_CHANNELS else "other"
    return _HANDLED_EXTERNALLY_TEXT[lang][key].format(name=name or "team")


async def mark_handled_externally(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    *,
    channel: str = "other",
    note: str = "",
    close: bool = False,
    language: str = "",
    actor_agent_id: UUID | None = None,
    actor_name: str = "",
) -> dict[str, Any] | None:
    """The conversation was settled outside Bokito (a call, a WhatsApp from a
    personal phone, a mail from another mailbox).

    Writes an outbound ``system_event`` so the thread counts as answered
    (needs-reply, previews), clears the unread flag, sets aside open reply
    proposals with reason ``handled_externally`` and optionally closes the
    thread. Returns the serialized system message.
    """
    signal = await _get_signal_row(session, tenant_id, signal_id)
    if not signal:
        return None
    if channel not in HANDLED_EXTERNALLY_CHANNELS:
        channel = "other"
    note = (note or "").strip()[:2000]
    if not actor_name:
        author = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
        actor_name = (author.display_name or author.email) if author else ""
    now = datetime.utcnow()
    text = handled_externally_text(channel, actor_name, language=language)
    body = f"{text}\n\n{note}" if note else text
    meta: dict[str, Any] = {
        "handled_externally": True,
        "channel": channel,
        "by_name": actor_name,
    }
    if note:
        meta["note"] = note
    if actor_agent_id:
        meta["by_agent_id"] = str(actor_agent_id)
    message = SignalMessage(
        signal_id=signal_id,
        tenant_id=tenant_id,
        kind="system_event",
        # Outbound: the team spoke last, even though nothing left Bokito.
        direction="outbound",
        role="system",
        author_user_id=user_id,
        author_agent_id=actor_agent_id,
        from_address="",
        to_addresses=signal.contact_email,
        subject=signal.subject,
        body_text=body,
        body_preview=clean_message_preview(body, limit=200),
        body_html="",
        metadata_json=json.dumps(meta),
        send_status="skipped",
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    signal.has_unread = False
    before_status = signal.status
    deferred = await _defer_open_reply_suggestions(
        session, tenant_id, signal_id, reason=DEFER_HANDLED_EXTERNALLY
    )
    await pick_up(session, signal, user_id, via="reply")
    if close and signal.status != "closed":
        from app.services.ai_handling import on_status_change

        signal.status = "closed"
        on_status_change(session, signal, actor_id=str(user_id))
        from app.services.tickets import settle_ticket_on_close

        await settle_ticket_on_close(session, signal, actor_type="user", actor_id=str(user_id))
    session.add(signal)
    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type="handled_externally",
            actor_type="agent" if actor_agent_id else "user",
            actor_id=str(actor_agent_id or user_id),
            payload_json=json.dumps(
                {"channel": channel, "closed": bool(close), "deferred_suggestions": deferred}
            ),
        )
    )
    from app.services.audit import record_audit

    await record_audit(
        session,
        tenant_id,
        action="signal:handled_externally",
        actor_type="agent" if actor_agent_id else "user",
        actor_id=actor_agent_id or user_id,
        resource_type="signal",
        resource_id=signal_id,
        summary=(signal.subject or "")[:120],
        before={"status": before_status},
        after={"status": signal.status, "channel": channel},
        commit=False,
    )
    await session.commit()
    await session.refresh(message)
    await session.refresh(signal)
    await publish_signal_message(signal, message)
    await publish_thread_update(signal)
    if signal.status == "closed" and before_status != "closed":
        from app.services.webhooks import emit_webhook_event, signal_event_data

        await emit_webhook_event(session, tenant_id, "signal.closed", signal_event_data(signal))
    return serialize_message(message)


async def deliver_due_outbound_messages(session: AsyncSession) -> int:
    """Deliver scheduled outbound messages whose send time passed (scheduler tick).

    Runs across all tenants. Failures mark the message `failed:*` so the
    operator sees it in the thread instead of a silent drop.
    """
    from app.channels import deliver_outbound

    now = datetime.utcnow()
    result = await session.execute(
        select(SignalMessage)
        .where(
            SignalMessage.send_status == "scheduled",
            SignalMessage.send_after.is_not(None),
            SignalMessage.send_after <= now,
        )
        .order_by(SignalMessage.send_after)
        .limit(25)
    )
    due = list(result.scalars().all())
    delivered = 0
    for message in due:
        signal = await session.get(Signal, message.signal_id)
        if not signal:
            message.send_status = "failed:thread_missing"
            session.add(message)
            continue
        meta: dict[str, Any] = {}
        try:
            meta = json.loads(message.metadata_json or "{}")
        except (TypeError, ValueError):
            meta = {}
        try:
            attachments = json.loads(message.attachments_json or "[]")
        except (TypeError, ValueError):
            attachments = []
        from app.services.signatures import resolve_from_display_name, resolve_signature_html

        send_as = "user" if message.author_user_id else "agent"
        signature_html = await resolve_signature_html(
            session,
            message.tenant_id,
            send_as=send_as,
            user_id=message.author_user_id,
            agent_id=message.author_agent_id or signal.agent_id,
            channel_account_id=signal.channel_account_id,
        )
        from_display_name = await resolve_from_display_name(
            session,
            message.tenant_id,
            send_as=send_as,
            user_id=message.author_user_id,
            agent_id=message.author_agent_id or signal.agent_id,
        )
        try:
            delivery = await deliver_outbound(
                session,
                signal,
                body_text=message.body_text,
                body_html=message.body_html or None,
                subject=str(meta.get("subject") or ""),
                to_address=str(meta.get("to") or "") or None,
                cc=meta.get("cc"),
                bcc=meta.get("bcc"),
                attachments=attachments or None,
                signature_html=signature_html,
                from_display_name=from_display_name,
                quoted_html=str(meta.get("quoted_html") or "") or None,
                suppress_threading=meta.get("reply_mode") == "forward",
            )
            status = delivery.status
            if delivery.body_html:
                message.body_html = delivery.body_html
            if delivery.from_address:
                message.from_address = delivery.from_address
            if delivery.to_address:
                message.to_addresses = delivery.to_address
            if delivery.provider_message_id:
                message.external_id = delivery.provider_message_id
        except Exception as exc:  # noqa: BLE001 — one bad message must not stall the queue
            logger.exception("Scheduled send failed for message %s", message.id)
            status = f"failed:{type(exc).__name__}"[:80]
        message.send_status = "sent" if status == "skipped" else status
        message.send_after = None
        session.add(message)
        delivered += 1
        await session.commit()
        await session.refresh(message)
        await publish_signal_message(signal, message)
    if due:
        await session.commit()
    return delivered


async def cancel_scheduled_message(
    session: AsyncSession,
    tenant_id: UUID,
    message_id: UUID,
) -> dict[str, Any] | None:
    """Soft undo: remove a still-scheduled outbound message before delivery.

    Returns the removed message's body so the composer can restore the draft,
    or None when the message is unknown or already (being) sent.
    """
    result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.tenant_id == tenant_id,
            SignalMessage.send_status == "scheduled",
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return None
    signal = await session.get(Signal, message.signal_id)
    body_text = message.body_text
    signal_id = message.signal_id
    await session.delete(message)
    if signal:
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=tenant_id,
                event_type="scheduled_send_cancelled",
                actor_type="user",
                actor_id="",
                payload_json="{}",
            )
        )
    await session.commit()
    if signal:
        await publish_thread_update(signal)
    return {"signal_id": str(signal_id), "body_text": body_text}


# Mentions use a stable inline markup so plain text stays readable:
# "@[Jane Doe](user:123456)" where the id is the dashboard numeric user id.
MENTION_PATTERN = re.compile(r"@\[([^\]]+)\]\(user:(\d+)\)")


async def notify_mentions(
    session: AsyncSession,
    tenant_id: UUID,
    signal: Signal,
    *,
    body_text: str,
    author_user_id: UUID | None,
    author_name: str = "",
) -> list[UUID]:
    """Notify @[Name](user:id) mentions in a message (tier 1). Returns the people mentioned."""
    from app.services.notify import TIER_NOW, notify

    mention_nums = {int(num) for _, num in MENTION_PATTERN.findall(body_text or "")}
    if not mention_nums:
        return []
    user_map = await _user_map(session, tenant_id)
    plain = MENTION_PATTERN.sub(lambda m: f"@{m.group(1)}", body_text or "")
    targets = [
        user_map[num]
        for num in sorted(mention_nums)
        if user_map.get(num) and user_map[num] != author_user_id
    ]
    if not targets:
        return []
    await notify(
        session,
        tenant_id,
        kind="mention",
        recipients=targets,
        title=f"{author_name or 'A teammate'} mentioned you in {signal.subject or 'a conversation'}",
        body=plain[:300],
        tier=TIER_NOW,
        category="mentions",
        signal_id=signal.id,
    )
    return targets


# Rapid Ja/Nee on stacked proposals would otherwise spawn one agent turn each.
_AGENT_REPLY_COALESCE_S = 1.25
_pending_agent_replies: dict[UUID, Any] = {}


def _schedule_agent_reply(
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    *,
    attachments: list[dict] | None = None,
) -> None:
    """Fire-and-forget agent reply on a fresh DB session (does not block HTTP).

    Multiple schedules for the same thread within ``_AGENT_REPLY_COALESCE_S``
    collapse into one wake (latest attachments win).
    """
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("No running loop to schedule agent reply for %s", signal_id)
        return

    existing = _pending_agent_replies.pop(signal_id, None)
    if existing is not None:
        try:
            existing.cancel()
        except Exception:
            pass

    async def _run() -> None:
        from app.db.session import async_session_factory

        _pending_agent_replies.pop(signal_id, None)
        async with async_session_factory() as bg_session:
            signal = await bg_session.get(Signal, signal_id)
            if not signal or signal.tenant_id != tenant_id:
                return
            await _generate_agent_reply(
                bg_session,
                tenant_id,
                user_id,
                signal,
                attachments=attachments,
            )

    def _fire() -> None:
        task = loop.create_task(_run())
        task.add_done_callback(
            lambda t: logger.exception(
                "Background agent reply failed for %s", signal_id, exc_info=t.exception()
            )
            if not t.cancelled() and t.exception()
            else None
        )

    _pending_agent_replies[signal_id] = loop.call_later(_AGENT_REPLY_COALESCE_S, _fire)


async def _generate_agent_reply(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal: Signal,
    *,
    attachments: list[dict] | None = None,
) -> None:
    """Run the thread's agent and append its reply.

    Best-effort: the user's message is already committed, so any failure here
    is logged and swallowed rather than surfaced to the caller. Gateway events
    (agent.turn / agent.activity / message.delta / message) keep the open
    thread live; each chat bubble arrives as its own message.
    """
    from app.services.agent.loop import AgentLoop
    from app.services.assistant_threads import signal_chat_history

    signal_id = signal.id
    agent = None
    try:
        # Auto-reply only when the thread explicitly involves an agent (pinned,
        # in the message history, or via its project) — the lead-agent fallback
        # would otherwise answer every bare internal thread.
        agent = await _resolve_thread_agent(
            session, tenant_id, signal, fallback_to_lead=False
        )
        if not agent or not agent.is_active:
            return
        from app.services.workforce_runtime import mark_agent_activity

        await mark_agent_activity(
            session,
            agent,
            status="working",
            summary=(signal.subject or "Replying")[:200],
            signal_id=signal.id,
        )
        history = await signal_chat_history(session, signal_id)
        loop = AgentLoop(
            session,
            tenant_id,
            user_id,
            agent=agent,
            signal_id=signal_id,
            enable_chat_thinking=True,
        )
        tokens: dict = {"input_tokens": 0, "output_tokens": 0}
        thinking_meta = None
        from app.services.thread_schedule import rule_context

        context = await rule_context(session, signal)
        async for event in loop.stream_chat(history, extra_context=context, attachments=attachments):
            if event["type"] == "done":
                tokens = event.get("usage", tokens)
                thinking_meta = loop.thinking_payload()
        final_meta: dict = {"usage": tokens}
        if thinking_meta:
            final_meta["thinking"] = thinking_meta
        await loop.persist_turn(signal, final_metadata=final_meta)
        await session.commit()
    except Exception:  # noqa: BLE001 - never break the user's reply
        await session.rollback()
        logger.exception("Failed to generate agent reply for signal %s", signal_id)
    finally:
        if agent is not None:
            try:
                from app.services.workforce_runtime import mark_agent_activity

                await mark_agent_activity(session, agent, status="standby")
            except Exception:  # noqa: BLE001
                logger.exception("Failed to reset agent runtime after reply %s", signal_id)


async def list_pins(session: AsyncSession, tenant_id: UUID, user_id: UUID) -> dict[str, list[str]]:
    pinned = await _pinned_ids(session, tenant_id, user_id)
    return {"thread_ids": [str(tid) for tid in sorted(pinned, key=str)]}


async def pin_thread(session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID) -> None:
    existing = await session.execute(
        select(SignalThreadPin).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
            SignalThreadPin.signal_id == signal_id,
        )
    )
    if existing.scalar_one_or_none():
        return
    session.add(SignalThreadPin(tenant_id=tenant_id, user_id=user_id, signal_id=signal_id))
    await session.commit()


async def unpin_thread(session: AsyncSession, tenant_id: UUID, user_id: UUID, signal_id: UUID) -> None:
    existing = await session.execute(
        select(SignalThreadPin).where(
            SignalThreadPin.tenant_id == tenant_id,
            SignalThreadPin.user_id == user_id,
            SignalThreadPin.signal_id == signal_id,
        )
    )
    row = existing.scalar_one_or_none()
    if row:
        await session.delete(row)
        await session.commit()


async def list_members(session: AsyncSession, tenant_id: UUID) -> list[dict[str, Any]]:
    result = await session.execute(
        select(User, Membership)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == tenant_id, User.is_active.is_(True), Membership.is_active.is_(True))
    )
    from app.services.presence import user_status

    now = datetime.utcnow()
    members = []
    for user, membership in result.all():
        members.append(
            {
                "id": user_numeric_id(user.id),
                "uuid": str(user.id),
                "name": user.display_name or user.email,
                "email": user.email,
                "avatar_url": user.avatar_url,
                "role": membership.role,
                "presence": user_status(user, now=now),
            }
        )
    return members


async def resolve_message_decision(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    signal_id: UUID,
    message_id: UUID,
    *,
    action: str,
    option_id: str | None = None,
    option_ids: list[str] | None = None,
    body: str | None = None,
    body_html: str | None = None,
    subject: str | None = None,
    response_text: str | None = None,
    # Sender identity for approved reply suggestions ("user" | "agent").
    send_as: str | None = None,
    # External resolution channel (e.g. "slack:U123"); lands in the event payload.
    source: str | None = None,
    messages: list[str] | None = None,
) -> dict[str, Any]:
    from app.services.decisions import resolve_decision_message

    if send_as is not None and send_as not in ("user", "agent"):
        raise HTTPException(status_code=400, detail="send_as must be 'user' or 'agent'")
    chosen_ids = [str(x) for x in (option_ids or []) if str(x).strip()]
    if option_id and str(option_id) not in chosen_ids:
        chosen_ids.insert(0, str(option_id))
    primary_option_id = chosen_ids[0] if chosen_ids else option_id

    msg_result = await session.execute(
        select(SignalMessage).where(
            SignalMessage.id == message_id,
            SignalMessage.signal_id == signal_id,
            SignalMessage.tenant_id == tenant_id,
        )
    )
    message = msg_result.scalar_one_or_none()
    if not message or not message.decision_id:
        raise HTTPException(status_code=404, detail="Decision message not found")

    payload_override: dict[str, Any] = {}
    if body is not None:
        payload_override["body"] = body
        payload_override["body_text"] = body
    if body_html is not None:
        payload_override["body_html"] = body_html
    if subject is not None:
        payload_override["subject"] = subject
    if response_text is not None and response_text.strip():
        payload_override["response_text"] = response_text.strip()
    if send_as is not None:
        payload_override["send_as"] = send_as
    if messages is not None:
        bubbles = [m.strip() for m in messages if isinstance(m, str) and m.strip()]
        if not bubbles:
            raise HTTPException(status_code=400, detail="messages must contain text")
        payload_override["messages"] = bubbles
        if body is None:
            body = "\n\n".join(bubbles)
            payload_override["body"] = body
            payload_override["body_text"] = body
    elif body is not None:
        # An edited body replaces the suggested bubbles: blank lines split again.
        from app.services.agent.reply_mode import split_chat_messages

        payload_override["messages"] = split_chat_messages(body)

    # An approved edit is the reply the operator actually wanted. Store it so
    # the next draft can follow that wording.
    if body is not None and user_id and action in ("approved", "approve"):
        from app.models.learning import Feedback
        from app.models.notification import DecisionRequest

        decision = await session.get(DecisionRequest, message.decision_id)
        original = ""
        if decision:
            try:
                options = json.loads(decision.options_json or "[]")
            except json.JSONDecodeError:
                options = []
            chosen = next(
                (
                    option
                    for option in options
                    if isinstance(option, dict)
                    and (not primary_option_id or str(option.get("id")) == primary_option_id)
                ),
                None,
            )
            if chosen:
                payload = chosen.get("payload")
                if isinstance(payload, dict):
                    original = str(payload.get("body_text") or payload.get("body") or "")
        if original.strip() and original.strip() != body.strip():
            inbound = (
                await session.execute(
                    select(SignalMessage.body_text)
                    .where(
                        SignalMessage.signal_id == signal_id,
                        SignalMessage.tenant_id == tenant_id,
                        SignalMessage.direction == "inbound",
                    )
                    .order_by(SignalMessage.created_at.desc())
                    .limit(1)
                )
            ).scalar_one_or_none()
            thread = await session.get(Signal, signal_id)
            category = (thread.category if thread else "") or "general"
            session.add(
                Feedback(
                    tenant_id=tenant_id,
                    subject_type="draft_edit",
                    subject_id=str(message.decision_id),
                    user_id=user_id,
                    comment=body[:2000],
                    correction_key=f"reply:{category}"[:160],
                    metadata_json=json.dumps(
                        {
                            "original": original[:2000],
                            "sent": body[:2000],
                            "customer": (inbound or "")[:2000],
                            "category": category,
                            "signal_id": str(signal_id),
                        }
                    ),
                )
            )

    from app.models.notification import DecisionRequest

    await resolve_decision_message(
        session,
        tenant_id,
        message.decision_id,
        action=action,
        user_id=user_id,
        option_id=primary_option_id,
        payload_override=payload_override or None,
    )
    decision_row = await session.get(DecisionRequest, message.decision_id)
    if decision_row and len(chosen_ids) > 1:
        decision_row.chosen_option_id = ",".join(chosen_ids)
        session.add(decision_row)

    try:
        options_list = json.loads((decision_row.options_json if decision_row else None) or "[]")
    except json.JSONDecodeError:
        options_list = []
    if not isinstance(options_list, list):
        options_list = []
    label_by_id = {
        str(o.get("id")): str(o.get("label") or o.get("id") or "")
        for o in options_list
        if isinstance(o, dict) and o.get("id")
    }
    option_labels = [label_by_id.get(oid, oid) for oid in chosen_ids] if chosen_ids else []
    answer = (response_text or "").strip()
    if not answer:
        if option_labels:
            answer = ", ".join(option_labels)
        elif action in ("rejected", "reject"):
            answer = "Reject"
        elif action in ("approved", "approve"):
            answer = "Approve"

    # Showcase items for the chosen options (id match or item_ref).
    reply_items: list[dict[str, Any]] = []
    try:
        card_meta = json.loads(message.metadata_json or "{}")
    except json.JSONDecodeError:
        card_meta = {}
    snapshots = card_meta.get("proposal_items") if isinstance(card_meta, dict) else None
    if not isinstance(snapshots, list):
        snapshots = []
    # Inline proposals store items on the host bubble (metadata.items).
    if not snapshots and isinstance(card_meta, dict):
        host_id = card_meta.get("attached_to_message_id")
        try:
            host_uuid = UUID(str(host_id)) if host_id else None
        except (TypeError, ValueError):
            host_uuid = None
        if host_uuid:
            host = await session.get(SignalMessage, host_uuid)
            if host and host.tenant_id == tenant_id:
                try:
                    host_meta = json.loads(host.metadata_json or "{}")
                except json.JSONDecodeError:
                    host_meta = {}
                host_items = host_meta.get("items") if isinstance(host_meta, dict) else None
                if isinstance(host_items, list):
                    snapshots = host_items
    for oid in chosen_ids:
        opt = next((o for o in options_list if isinstance(o, dict) and str(o.get("id")) == oid), None)
        ref = opt.get("item_ref") if isinstance(opt, dict) else None
        match = None
        if isinstance(ref, dict):
            match = next(
                (
                    s
                    for s in snapshots
                    if isinstance(s, dict)
                    and s.get("type") == ref.get("type")
                    and str(s.get("id")) == str(ref.get("id") or "")
                ),
                None,
            )
        if match is None:
            match = next((s for s in snapshots if isinstance(s, dict) and str(s.get("id")) == oid), None)
        if match:
            reply_items.append(match)

    session.add(
        SignalEvent(
            signal_id=signal_id,
            tenant_id=tenant_id,
            event_type=f"decision_{action}",
            actor_type="user",
            actor_id=str(user_id) if user_id else "",
            payload_json=json.dumps(
                {
                    "decision_id": str(message.decision_id),
                    "action": action,
                    "option_id": primary_option_id,
                    "option_ids": chosen_ids,
                    "option_labels": option_labels,
                    "response_text": (response_text or "").strip() or None,
                    "via": source,
                    "has_reply_message": bool(answer and user_id),
                }
            ),
        )
    )
    # Suggested-reply cards already leave an outbound email (or escalate event).
    # Session-checkout buttons close the meta session via apply_checkout_choice.
    # Recording the button label ("Send" / "End session") as a chat bubble
    # clutters the customer timeline.
    decision_title = (decision_row.title if decision_row else "") or ""
    chosen_action_types = {
        str(o.get("action_type") or "")
        for o in options_list
        if isinstance(o, dict) and str(o.get("id")) in set(chosen_ids)
    }
    skip_decision_chat = decision_title in REPLY_SUGGESTION_TITLES or bool(
        chosen_action_types & {"send_reply", "draft", "escalate", "session_checkout"}
    )
    if answer and user_id and not skip_decision_chat:
        sig_result = await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
        signal = sig_result.scalar_one_or_none()
        if signal:
            from app.services.assistant_threads import append_signal_chat_message

            await append_signal_chat_message(
                session,
                signal,
                role="user",
                content=answer,
                author_user_id=user_id,
                metadata={
                    "decision_id": str(message.decision_id),
                    "decision_response": True,
                    "decision_action": action,
                    "option_id": primary_option_id,
                    "option_ids": chosen_ids,
                    "items": reply_items,
                },
            )

    # Learning hook: approved choices on "No reply needed" cards teach a
    # per-sender inbox rule (close / task). Consistent choices surface an
    # inline "always do this" suggestion; autonomous tenants auto-promote.
    rule_suggestion = None
    if user_id and action in ("approved", "approve") and primary_option_id in ("close", "create_task", "look_at"):
        rule_suggestion = await _record_no_reply_outcome(
            session, tenant_id, user_id, signal_id, message.decision_id, primary_option_id
        )

    # Approving one draft dismisses leftover sibling suggestion cards.
    if action in ("approve", "approved"):
        await _defer_open_reply_suggestions(
            session, tenant_id, signal_id, reason="human_approved_sibling"
        )

    await session.commit()

    # Approving "create a task" / legacy look_at puts a date on the conversation.
    created_task_id: str | None = None
    continue_signal: Signal | None = None
    if user_id and action in ("approved", "approve") and primary_option_id in ("create_task", "look_at"):
        from datetime import timedelta

        from app.services.thread_schedule import apply_thread_schedule

        sig_result = await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
        signal = sig_result.scalar_one_or_none()
        if signal:
            await apply_thread_schedule(
                session,
                tenant_id,
                signal=signal,
                at=datetime.utcnow() + timedelta(hours=4),
                recipient=("user", user_id),
                created_by_user_id=user_id,
                actor_id=str(user_id),
            )
            await session.commit()

    # Chat / Ask threads: after Ja/Nee the operator bubble is not enough —
    # wake the agent so it confirms (and finishes work if the option had no tool).
    continue_signal: Signal | None = None
    if (
        user_id
        and answer
        and action in ("approved", "approve", "rejected", "reject")
    ):
        sig_result = await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
        continue_signal = sig_result.scalar_one_or_none()
        if continue_signal and _should_continue_chat_after_decision(continue_signal):
            # Pin the asking agent when the thread has none (Ask / soft chats).
            if not continue_signal.agent_id:
                asker = message.author_agent_id
                if asker is None and decision_row and decision_row.source_type == "agent":
                    try:
                        asker = UUID(str(decision_row.source_id)) if decision_row.source_id else None
                    except (TypeError, ValueError):
                        asker = None
                if asker is not None:
                    continue_signal.agent_id = asker
                    session.add(continue_signal)

    await session.commit()

    if user_id and continue_signal is not None and _should_continue_chat_after_decision(continue_signal):
        from app.tools.registry import get_tool_spec

        chosen_opt = next(
            (
                o
                for o in options_list
                if isinstance(o, dict) and str(o.get("id")) == str(primary_option_id or "")
            ),
            None,
        )
        action_type = ""
        if isinstance(chosen_opt, dict):
            action_type = str(chosen_opt.get("action_type") or "").strip()
        tool_ran = bool(
            action in ("approved", "approve")
            and action_type
            and action_type not in ("reject", "defer", "acknowledge")
            and get_tool_spec(action_type) is not None
        )
        # Tool already executed on Approve: a short confirm is clearer than an
        # LLM wake that re-lists tags and proposes the same delete again.
        # Soft Yes also stays quiet when other proposals are still open — waking
        # then stacks new asks on top of unresolved cards.
        other_open = 0
        if message.decision_id is not None:
            other_open = len(
                (
                    await session.execute(
                        select(DecisionRequest.id).where(
                            DecisionRequest.signal_id == continue_signal.id,
                            DecisionRequest.status == "awaiting_human",
                            DecisionRequest.id != message.decision_id,
                        )
                    )
                ).scalars().all()
            )
        if tool_ran or action in ("rejected", "reject") or other_open > 0:
            confirm = _decision_confirm_text(
                action=action,
                action_type=action_type,
                option=chosen_opt if isinstance(chosen_opt, dict) else None,
                option_labels=option_labels,
            )
            asker = continue_signal.agent_id or message.author_agent_id
            from app.services.assistant_threads import append_signal_chat_message

            await append_signal_chat_message(
                session,
                continue_signal,
                role="assistant",
                content=confirm,
                author_agent_id=asker,
                metadata={"decision_confirm": True, "decision_id": str(message.decision_id)},
            )
            await session.commit()
        else:
            # Soft Yes (no tool), sole open card: let the agent answer conversationally.
            from app.config import get_settings

            if get_settings().bokito_mock_execution:
                await _generate_agent_reply(session, tenant_id, user_id, continue_signal)
            else:
                _schedule_agent_reply(tenant_id, user_id, continue_signal.id)

    return {
        "ok": True,
        "action": action,
        "option_id": primary_option_id or option_id,
        "option_ids": chosen_ids,
        "rule_suggestion": rule_suggestion,
        "task_id": created_task_id,
    }


_BUNDLE_COPY = {
    "en": {"approved": "Approved", "rejected": "Rejected", "failed": "Failed"},
    "nl": {"approved": "Goedgekeurd", "rejected": "Afgewezen", "failed": "Mislukt"},
}


def _bundle_action_label(decision: DecisionRequest) -> str:
    entry = bundle_entry_payload(decision)
    action = entry.get("action") if isinstance(entry.get("action"), dict) else None
    if action and action.get("fallback"):
        return str(action["fallback"])
    title = decision.title or ""
    for prefix in ("Review: ", "Approve: "):
        if title.startswith(prefix):
            return title[len(prefix):]
    return title


async def resolve_decision_bundle(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID | None,
    signal_id: UUID,
    *,
    decision_ids: list[UUID],
    approve: list[str] | str,
    reject: list[str] | str,
) -> dict[str, Any]:
    """Resolve several action cards of one agent turn in one go.

    ``approve`` is ``"all"`` or a list of decision ids; ``reject`` is
    ``"rest"`` (every listed card not approved) or a list. Each card runs
    through the normal resolve path, so platform changes and tool calls
    execute exactly as a single Approve would; one failing action leaves the
    others resolved and comes back as ``error`` on its row. One operator
    bubble sums up the outcome."""
    from app.models.auth import Tenant
    from app.services.decisions import resolve_decision_message
    from app.services.language import resolve_workspace_language

    rows = list(
        (
            await session.execute(
                select(DecisionRequest).where(
                    DecisionRequest.id.in_(decision_ids),
                    DecisionRequest.tenant_id == tenant_id,
                    DecisionRequest.signal_id == signal_id,
                )
            )
        ).scalars().all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="No decisions found for this bundle")
    by_id = {str(d.id): d for d in rows}
    ordered_ids = [str(did) for did in decision_ids if str(did) in by_id]
    approve_ids = ordered_ids if approve == "all" else [str(x) for x in approve if str(x) in by_id]
    if reject == "rest":
        reject_ids = [did for did in ordered_ids if did not in approve_ids]
    else:
        reject_ids = [str(x) for x in reject if str(x) in by_id and str(x) not in approve_ids]

    results: list[dict[str, Any]] = []
    approved_labels: list[str] = []
    rejected_labels: list[str] = []
    failed_labels: list[str] = []
    for did in approve_ids + reject_ids:
        decision = by_id[did]
        label = _bundle_action_label(decision)
        if decision.status != "awaiting_human":
            results.append({"decision_id": did, "status": decision.status, "skipped": True})
            continue
        entry = bundle_entry_payload(decision)
        approving = did in approve_ids
        option_id = entry["approve_option_id"] if approving else entry["reject_option_id"]
        try:
            await resolve_decision_message(
                session,
                tenant_id,
                decision.id,
                action="approved" if approving else "rejected",
                user_id=user_id,
                option_id=option_id,
            )
        except HTTPException as exc:
            # The resolver already reopened the card and committed.
            failed_labels.append(label)
            results.append({"decision_id": did, "status": "awaiting_human", "error": str(exc.detail)})
            continue
        refreshed = await session.get(DecisionRequest, decision.id)
        status = refreshed.status if refreshed else ("approved" if approving else "rejected")
        results.append({"decision_id": did, "status": status})
        (approved_labels if approving else rejected_labels).append(label)
        session.add(
            SignalEvent(
                signal_id=signal_id,
                tenant_id=tenant_id,
                event_type=f"decision_{'approved' if approving else 'rejected'}",
                actor_type="user",
                actor_id=str(user_id) if user_id else "",
                payload_json=json.dumps(
                    {
                        "decision_id": did,
                        "action": "approved" if approving else "rejected",
                        "option_id": option_id,
                        "bundle": True,
                        "has_reply_message": False,
                    }
                ),
            )
        )
        await session.commit()

    signal = (
        await session.execute(select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if signal and user_id and (approved_labels or rejected_labels):
        tenant = await session.get(Tenant, tenant_id)
        copy = _BUNDLE_COPY.get(resolve_workspace_language(tenant) if tenant else "en", _BUNDLE_COPY["en"])
        parts: list[str] = []
        if approved_labels:
            parts.append(f"{copy['approved']}: {', '.join(approved_labels)}")
        if rejected_labels:
            parts.append(f"{copy['rejected']}: {', '.join(rejected_labels)}")
        if failed_labels:
            parts.append(f"{copy['failed']}: {', '.join(failed_labels)}")
        from app.services.assistant_threads import append_signal_chat_message

        await append_signal_chat_message(
            session,
            signal,
            role="user",
            content=" · ".join(parts),
            author_user_id=user_id,
            metadata={
                "decision_response": True,
                "decision_bundle": True,
                "decision_ids": approve_ids + reject_ids,
                "decision_action": "approved" if approved_labels else "rejected",
            },
        )
        await session.commit()
    return {"ok": not failed_labels, "results": results}


def _should_continue_chat_after_decision(signal: Signal) -> bool:
    """Assistant, internal, and Ask/meta chats should keep talking after a decision."""
    if signal.channel in ("assistant", "internal"):
        return True
    return signal.source in ("agent_session", "chat", "personal")


def _decision_confirm_text(
    *,
    action: str,
    action_type: str,
    option: dict[str, Any] | None,
    option_labels: list[str],
) -> str:
    """Short in-thread confirm after Ja/Nee — no LLM round-trip."""
    payload = option.get("payload") if isinstance(option, dict) else None
    if not isinstance(payload, dict):
        payload = {}
    name = str(payload.get("name") or payload.get("tag") or "").strip().lstrip("#")
    if action in ("rejected", "reject"):
        if name:
            return f"Oké, #{name} blijft staan."
        return "Oké."
    if action_type == "delete_tag" and name:
        return f"#{name} is verwijderd."
    if option_labels:
        return f"Gedaan: {option_labels[0]}."
    return "Gedaan."


async def _record_no_reply_outcome(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal_id: UUID,
    decision_id: UUID,
    option_id: str,
) -> dict[str, Any] | None:
    """Feed an approved action-suggestion choice into the inbox-rule learner."""
    from app.models.auth import Tenant
    from app.models.learning import Feedback
    from app.models.notification import DecisionRequest, Notification
    from app.services import inbox_rules
    from app.tools.policy import resolve_posture

    decision = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id == decision_id, DecisionRequest.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if not decision or not decision.notification_id:
        return None
    notification = (
        await session.execute(
            select(Notification).where(Notification.id == decision.notification_id)
        )
    ).scalar_one_or_none()
    try:
        notif_payload = json.loads(notification.payload_json or "{}") if notification else {}
    except json.JSONDecodeError:
        notif_payload = {}
    if notif_payload.get("kind") != "action_suggestion":
        return None

    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if not signal or signal.source == "demo":
        # The onboarding demo thread never teaches rules.
        return None
    inbound = (
        await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == signal_id, SignalMessage.direction == "inbound")
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    from_address = (inbound.from_address if inbound else "") or signal.contact_email or ""
    try:
        inbound_meta = json.loads(inbound.metadata_json or "{}") if inbound else {}
    except json.JSONDecodeError:
        inbound_meta = {}
    auto_headers = (
        inbound_meta.get("auto_headers") if isinstance(inbound_meta, dict) else None
    )

    session.add(
        Feedback(
            tenant_id=tenant_id,
            subject_type="decision",
            subject_id=str(decision_id),
            user_id=user_id,
            comment=f"no_reply_action:{option_id}",
        )
    )

    tenant = await session.get(Tenant, tenant_id)
    auto_promote = bool(tenant) and resolve_posture(tenant) == "autonomous"
    return await inbox_rules.record_outcome(
        session,
        tenant_id,
        from_address=from_address,
        headers=auto_headers,
        option_id=option_id,
        sender_label=signal.contact_name or from_address,
        user_id=user_id,
        auto_promote=auto_promote,
    )


async def dismiss_no_reply_suggestions(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    *,
    also_close_threads: bool = False,
) -> dict[str, Any]:
    """Clear backlog of awaiting 'No reply needed' tip cards in one action.

    Resolves each as keep_open (card gone, thread stays open) unless
    ``also_close_threads`` is set. Does not teach inbox rules — bulk dismiss
    is cleanup, not a preference signal.
    """
    from app.services.automated_mail import NO_REPLY_DECISION_TITLE
    from app.services.decisions import resolve_decision_message

    rows = (
        await session.execute(
            select(DecisionRequest, SignalMessage.signal_id)
            .join(SignalMessage, SignalMessage.decision_id == DecisionRequest.id)
            .join(Signal, Signal.id == SignalMessage.signal_id)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.title == NO_REPLY_DECISION_TITLE,
                Signal.status.notin_(("closed", "spam")),
            )
        )
    ).all()

    seen_decisions: set[UUID] = set()
    dismissed = 0
    closed = 0
    for decision, signal_id in rows:
        if decision.id in seen_decisions:
            continue
        seen_decisions.add(decision.id)
        await resolve_decision_message(
            session,
            tenant_id,
            decision.id,
            action="approve",
            user_id=user_id,
            option_id="keep_open",
        )
        session.add(
            SignalEvent(
                signal_id=signal_id,
                tenant_id=tenant_id,
                event_type="decision_dismissed",
                actor_type="user",
                actor_id=str(user_id),
                payload_json=json.dumps(
                    {
                        "decision_id": str(decision.id),
                        "action": "dismiss",
                        "option_id": "keep_open",
                        "via": "bulk_no_reply",
                    }
                ),
            )
        )
        dismissed += 1
        if also_close_threads:
            signal = (
                await session.execute(
                    select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
                )
            ).scalar_one_or_none()
            if signal and signal.status == "open":
                from app.services.ai_handling import on_status_change

                signal.status = "closed"
                signal.has_unread = False
                signal.updated_at = datetime.utcnow()
                on_status_change(session, signal)
                from app.services.tickets import settle_ticket_on_close

                await settle_ticket_on_close(session, signal, actor_type="user", actor_id=str(user_id))
                session.add(signal)
                session.add(
                    SignalEvent(
                        signal_id=signal_id,
                        tenant_id=tenant_id,
                        event_type="thread_updated",
                        actor_type="user",
                        actor_id=str(user_id),
                        payload_json=json.dumps({"status": "closed", "bulk": "close", "via": "bulk_no_reply"}),
                    )
                )
                closed += 1

    await session.commit()
    return {"ok": True, "dismissed": dismissed, "closed": closed}
