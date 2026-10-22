"""Resolve a decision in a conversation and the follow-up."""

from __future__ import annotations

from app.core.time import utcnow

import json
import logging
from datetime import timedelta
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.publish import publish_signal_message
from app.models.notification import DecisionRequest, Notification
from app.models.signal import (
    Signal,
    SignalEvent,
    SignalMessage,
    SignalTag,
)


logger = logging.getLogger(__name__)



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
    from app.services.signal_threads.mutations import _defer_open_reply_suggestions
    from app.services.signal_threads.reply import _generate_agent_reply, _schedule_agent_reply
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
        # An edited chat body replaces the suggested bubbles: one paragraph each.
        # Email keeps the letter, including a short list.
        from app.services.agent.reply_mode import MAIL, reply_mode_for, split_chat_messages

        signal = await session.get(Signal, signal_id)
        if reply_mode_for(signal.channel if signal else None) == MAIL:
            payload_override["messages"] = [body.strip()] if body.strip() else []
        else:
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
            flow_label = (
                await session.get(SignalTag, thread.ticket_tag_id) if thread and thread.ticket_tag_id else None
            )
            category = (flow_label.name if flow_label else "") or "general"
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
            from app.services.deliveries import TARGET_KNOWLEDGE, record_delivery

            await record_delivery(
                session,
                tenant_id,
                signal_id,
                target_kind=TARGET_KNOWLEDGE,
                ref=f"draft_edit:{message_id}",
                user_id=user_id,
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
                    # Option-label echoes stay off the timeline; free-text answers still post.
                    "has_reply_message": bool((response_text or "").strip() and user_id),
                }
            ),
        )
    )
    # Typed answers on a decision (e.g. "other" with a note) stay as chat content.
    # Plain Approve/Reject labels do not — attribution lives on the cloud.
    if user_id and (response_text or "").strip():
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
                content=(response_text or "").strip(),
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
                at=utcnow() + timedelta(hours=4),
                owner=("user", user_id),
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
        tool_ran = _decision_option_already_ran(action, action_type)
        # Soft Yes with other open cards: do not wake — that stacks new asks.
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
        label = option_labels[0] if option_labels else (decision_row.title if decision_row else "proposal")
        outcomes = [
            {
                "decision_id": str(message.decision_id),
                "action": "approved" if action in ("approved", "approve") else "rejected",
                "label": label,
                "action_type": action_type,
                "tool_ran": tool_ran,
            }
        ]
        if tool_ran or action in ("rejected", "reject"):
            await _follow_up_after_decision_outcomes(
                session,
                tenant_id,
                user_id,
                continue_signal,
                outcomes=outcomes,
                asker_agent_id=continue_signal.agent_id or message.author_agent_id,
            )
        elif other_open == 0:
            # Soft Yes (no tool), sole open card: let the agent answer conversationally.
            from app.config import get_settings

            if get_settings().bokito_mock_execution:
                await _generate_agent_reply(session, tenant_id, user_id, continue_signal)
            else:
                _schedule_agent_reply(tenant_id, user_id, continue_signal.id)
        else:
            # Soft Yes with other open cards: short confirm, no LLM wake (avoids stacking asks).
            from app.services.assistant_threads import append_signal_chat_message

            confirm = _decision_confirm_text_from_outcomes(outcomes)
            await append_signal_chat_message(
                session,
                continue_signal,
                role="assistant",
                content=confirm,
                author_agent_id=continue_signal.agent_id or message.author_agent_id,
                metadata={
                    "decision_confirm": True,
                    "decision_ids": [str(message.decision_id)] if message.decision_id else [],
                },
            )
            await session.commit()

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
    from app.services.signal_threads.serialize import bundle_entry_payload
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
    others resolved and comes back as ``error`` on its row. The decision cloud
    shows who resolved; chat threads get an agent follow-up, not a user bubble."""
    from app.services.signal_threads.serialize import bundle_entry_payload
    from app.services.decisions import resolve_decision_message

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
    outcomes: list[dict[str, Any]] = []
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
        action_type = str(entry.get("action_type") or "")
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
            outcomes.append(
                {
                    "decision_id": did,
                    "action": "failed",
                    "label": label,
                    "action_type": action_type,
                    "tool_ran": False,
                    "error": str(exc.detail),
                }
            )
            continue
        refreshed = await session.get(DecisionRequest, decision.id)
        status = refreshed.status if refreshed else ("approved" if approving else "rejected")
        results.append({"decision_id": did, "status": status})
        outcomes.append(
            {
                "decision_id": did,
                "action": "approved" if approving else "rejected",
                "label": label,
                "action_type": action_type,
                "tool_ran": bool(approving and action_type and action_type not in ("reject", "defer")),
            }
        )
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
    settled = [o for o in outcomes if o.get("action") in ("approved", "rejected", "failed")]
    if signal and user_id and settled and _should_continue_chat_after_decision(signal):
        if not signal.agent_id and rows:
            # Pin the asking agent when the thread has none.
            asker = rows[0].source_id if rows[0].source_type == "agent" else None
            if asker:
                try:
                    signal.agent_id = UUID(str(asker))
                    session.add(signal)
                    await session.commit()
                except (TypeError, ValueError):
                    pass
        await _follow_up_after_decision_outcomes(
            session,
            tenant_id,
            user_id,
            signal,
            outcomes=settled,
            asker_agent_id=signal.agent_id,
        )
    return {"ok": not failed_labels, "results": results}


def _decision_option_already_ran(action: str, action_type: str) -> bool:
    """True when approving this option already did the work.

    Registered tools and resolver actions (inbox rules, module setup, …)
    both count. A soft yes with no action still wakes the agent without
    this hint.
    """
    from app.tools.builtin import RESOLVER_ACTIONS
    from app.tools.registry import get_tool_spec

    if action not in ("approved", "approve"):
        return False
    kind = (action_type or "").strip()
    if not kind or kind in ("reject", "defer", "acknowledge"):
        return False
    return kind in RESOLVER_ACTIONS or get_tool_spec(kind) is not None


_SILENT_TURN_BODIES = frozenset({"", "Done."})


def _turn_has_visible_speech(messages: list[Any]) -> bool:
    for message in messages or []:
        text = (getattr(message, "body_text", "") or "").strip()
        if text and text not in _SILENT_TURN_BODIES:
            return True
    return False


async def _fill_silent_decision_follow_up(
    session: AsyncSession,
    signal: Signal,
    saved: list[Any],
    agent_id: UUID | None,
    outcomes: list[dict[str, Any]],
) -> None:
    """When a choice-wake saved no sentence, leave the short confirm instead."""
    if not outcomes or _turn_has_visible_speech(saved):
        return
    confirm = _decision_confirm_text_from_outcomes(outcomes)
    from app.services.assistant_threads import append_signal_chat_message

    target = next(
        (
            message
            for message in saved
            if (getattr(message, "body_text", "") or "").strip() in _SILENT_TURN_BODIES
        ),
        None,
    )
    if target is None:
        rows = (
            await session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == signal.id,
                    SignalMessage.tenant_id == signal.tenant_id,
                    SignalMessage.kind == "agent_message",
                )
                .order_by(SignalMessage.created_at.desc())
                .limit(4)
            )
        ).scalars().all()
        fresh_after = utcnow() - timedelta(minutes=2)
        for row in rows:
            text = (row.body_text or "").strip()
            recent = row.created_at is None or row.created_at >= fresh_after
            if recent and text in _SILENT_TURN_BODIES:
                target = row
                break
    if target is not None:
        try:
            meta = json.loads(target.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict):
            meta = {}
        meta.pop("turn_failed", None)
        meta["decision_confirm"] = True
        target.body_text = confirm
        target.body_preview = confirm[:200]
        target.metadata_json = json.dumps(meta, default=str)
        if agent_id and not target.author_agent_id:
            target.author_agent_id = agent_id
        session.add(target)
        await session.commit()
        await publish_signal_message(signal, target)
        return
    message = await append_signal_chat_message(
        session,
        signal,
        role="assistant",
        content=confirm,
        author_agent_id=agent_id,
        metadata={"decision_confirm": True},
    )
    await session.commit()
    await publish_signal_message(signal, message)


def _should_continue_chat_after_decision(signal: Signal) -> bool:
    """Assistant, internal, and Ask/meta chats should keep talking after a decision."""
    if signal.channel in ("assistant", "internal"):
        return True
    return signal.source in ("agent_session", "chat", "personal")


def _decision_outcome_brief(outcomes: list[dict[str, Any]]) -> str:
    """Why this turn runs: the operator just resolved cards. Context for one wake, never stored."""
    lines: list[str] = [
        "The operator just answered your card(s) in this conversation; the card "
        "already shows their choice. When a tool ran, confirm briefly and do not "
        "call that gated tool again; showcase with attach_items when something "
        "useful was created. When they picked an answer, continue the work with it. "
        "If something failed, say so and offer a next step."
    ]
    for row in outcomes:
        action = str(row.get("action") or "")
        label = str(row.get("label") or "action")
        action_type = str(row.get("action_type") or "")
        if action == "approved" and not action_type:
            lines.append(f"- Answered: {label}")
        elif action == "approved":
            ran = " Tool already executed." if row.get("tool_ran") else ""
            lines.append(f"- Approved: {label} ({action_type})" + ran)
        elif action == "rejected":
            lines.append(f"- Declined: {label}" + (f" ({action_type})" if action_type else ""))
        elif action == "failed":
            err = str(row.get("error") or "unknown error")
            lines.append(f"- Failed to run: {label} — {err}")
    return "\n".join(lines)


def _decision_confirm_text_from_outcomes(outcomes: list[dict[str, Any]]) -> str:
    """Canned confirm for mock / no-agent — no LLM round-trip."""
    approved = [o for o in outcomes if o.get("action") == "approved"]
    rejected = [o for o in outcomes if o.get("action") == "rejected"]
    failed = [o for o in outcomes if o.get("action") == "failed"]
    if failed and not approved and not rejected:
        return "Dat lukte niet. Wil je het opnieuw proberen?"
    if rejected and not approved:
        return "Oké."
    if approved and not rejected:
        label = str(approved[0].get("label") or "").strip()
        if label:
            return f"Gedaan: {label}."
        return "Gedaan."
    return "Verwerkt."


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
    # Leftover wrap-up cards: never echo English button labels like "Keep going".
    if action_type == "session_checkout" or payload.get("session_checkout"):
        kind = str(payload.get("kind") or "").strip()
        if kind == "continue":
            return "Oké, we gaan door."
        return "Sessie afgerond."
    if action_type == "delete_tag" and name:
        return f"#{name} is verwijderd."
    if option_labels:
        return f"Gedaan: {option_labels[0]}."
    return "Gedaan."


async def _follow_up_after_decision_outcomes(
    session: AsyncSession,
    tenant_id: UUID,
    user_id: UUID,
    signal: Signal,
    *,
    outcomes: list[dict[str, Any]],
    asker_agent_id: UUID | None,
) -> None:
    """Wake the agent with the outcome as its brief (or post a canned confirm).

    The resolved cards are already in the thread; nothing else is written.
    """
    from app.services.signal_threads.reply import _schedule_agent_reply
    if not outcomes:
        return
    from app.config import get_settings
    from app.services.assistant_threads import append_signal_chat_message

    settings = get_settings()
    agent_id = signal.agent_id or asker_agent_id
    if settings.bokito_mock_execution or agent_id is None:
        confirm = _decision_confirm_text_from_outcomes(outcomes)
        await append_signal_chat_message(
            session,
            signal,
            role="assistant",
            content=confirm,
            author_agent_id=agent_id,
            metadata={
                "decision_confirm": True,
                "decision_ids": [str(o.get("decision_id") or "") for o in outcomes if o.get("decision_id")],
            },
        )
        await session.commit()
        return
    _schedule_agent_reply(tenant_id, user_id, signal.id, decision_outcomes=outcomes)


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
    from app.models.notification import DecisionRequest
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
                signal.updated_at = utcnow()
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
