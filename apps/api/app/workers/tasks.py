import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from arq import create_pool, cron
from arq.connections import RedisSettings
from sqlalchemy import select

from app.config import get_settings
from app.db.session import async_session_factory, init_db
from app.models.agent import Agent, AgentRun, RunEvent
from app.models.channel import ChannelAccount
from app.models.signal import Signal, SignalEvent, SignalMessage
from app.services.agent.loop import AgentLoop
from app.services.orchestration.runner import run_agent_task_segment

settings = get_settings()


@dataclass
class InboundPreflight:
    """Shared interpret + reply verdicts for one inbound message."""

    msg: SignalMessage | None
    sender_address: str
    auto_headers: Any
    classification: dict[str, Any]
    is_member: bool

# Assisted inbound: research + thread read + gated contact/ticket tools +
# inline decisions. create_queue_item under "ask" still renders a proposal card.
# Sending / platform mutations stay off this list.
SUGGEST_MODE_TOOLS = frozenset(
    {
        "search_index",
        "web_search",
        "search_product_help",
        "list_docs",
        "read_doc",
        "get_tenant_overview",
        "call_mcp_tool",
        "create_decision_request",
        "propose_action",
        "attach_items",
        "list_tags",
        "list_categories",
        "list_projects",
        "list_queue_items",
        "list_project_docs",
        "create_queue_item",
        "record_thread_read",
        "suggest_thread_reply",
        "note_no_reply",
        "set_thread_tags",
        "file_ticket",
        "get_ticket",
        "get_contact",
        "list_contacts",
        "upsert_contact",
        "link_conversation_contact",
    }
)

# Manual AI handling: the channel agent may read and file, never draft or send.
MANUAL_READ_TOOLS = frozenset(
    {
        "record_thread_read",
        "set_thread_tags",
        "file_ticket",
        "list_tags",
        "list_categories",
        "get_ticket",
        "get_contact",
        "list_contacts",
        "upsert_contact",
        "link_conversation_contact",
        "search_index",
        "list_docs",
        "read_doc",
        "split_conversation",
    }
)


def assisted_tool_allowed(name: str) -> bool:
    """Assisted runs keep the allow-list plus ungated module reads.

    Module read tools (``accounting_list_companies`` and friends) are
    non-mutating and not gated, so they never raise an approval card; they
    are the right path to records in connected systems, not ``call_mcp_tool``.
    """
    if name in SUGGEST_MODE_TOOLS:
        return True
    from app.tools.registry import get_tool_spec

    spec = get_tool_spec(name)
    return bool(
        spec
        and spec.category == "integrations"
        and not spec.mutating
        and not spec.gated
    )


def autonomous_gate_reason(signal, agent, *, now: datetime | None = None) -> str | None:
    """Why an autonomous run must draft instead of send, or None when it may send.

    ``not_owner``: a person or team owns the conversation (the agent drafts
    for them). ``human_composing``: a person is typing a reply right now.
    """
    if signal.assignee_kind != "agent" or signal.agent_id != agent.id:
        return "not_owner"
    until = signal.human_composing_until
    if until is not None and until > (now or datetime.utcnow()):
        return "human_composing"
    return None


def assist_handover_reason(delivery: dict | None) -> str:
    """Why the agent hands an open conversation to a person after its run."""
    status = str((delivery or {}).get("delivery") or "")
    if status == "run_failed":
        return "run_failed"
    if status == "pending_approval":
        return "draft_ready"
    if status == "pending_decision":
        return "pending_decision"
    if status in ("no_reply_needed", "no_reply_noted"):
        return "no_reply_needed"
    return "needs_person"


async def _hand_over_after_assist(session, signal, agent, delivery, *, reason: str | None = None) -> None:
    """After an inbound run: an agent-owned, still open conversation that got
    nothing sent to the customer goes to a person (draft ready, card, failure)."""
    from app.services.handover import hand_to_people_after_assist

    if signal.assignee_kind != "agent" or signal.status == "closed":
        return
    delivery = delivery if isinstance(delivery, dict) else {}
    status = str(delivery.get("delivery") or "")
    if delivery.get("delivered_to_customer") or status.startswith("sent"):
        return
    if status in ("archived", "closed"):
        return
    await hand_to_people_after_assist(
        session, signal, agent=agent, reason=reason or assist_handover_reason(delivery)
    )


async def startup(ctx):
    from app.observability import init_observability

    init_observability("worker")
    await init_db()


async def _inbound_preflight(
    session, tenant_id: UUID, signal: Signal
) -> InboundPreflight:
    """Load newest inbound + automated/member checks once per job."""
    from app.services.automated_mail import classify_automated_email
    from app.services.workspace_members import find_member_by_email

    msg = (
        await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == signal.id, SignalMessage.direction == "inbound")
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if msg is None:
        return InboundPreflight(
            msg=None,
            sender_address="",
            auto_headers=None,
            classification={"automated": False, "reason": ""},
            is_member=False,
        )
    try:
        msg_meta = json.loads(msg.metadata_json or "{}")
    except json.JSONDecodeError:
        msg_meta = {}
    sender = msg.from_address or signal.contact_email or ""
    headers = msg_meta.get("auto_headers") if isinstance(msg_meta, dict) else None
    classification = classify_automated_email(
        sender, headers=headers, subject=signal.subject or ""
    )
    # Prefer live membership lookup. A stale author_user_id can remain on a
    # message ingested before the sender was deactivated; that must not keep
    # skipping AI once Membership.is_active is false.
    is_member = bool(await find_member_by_email(session, tenant_id, sender))
    if not is_member and msg.author_user_id:
        from app.models.auth import Membership

        active = (
            await session.execute(
                select(Membership.id).where(
                    Membership.tenant_id == tenant_id,
                    Membership.user_id == msg.author_user_id,
                    Membership.is_active.is_(True),
                ).limit(1)
            )
        ).scalar_one_or_none()
        is_member = active is not None
    return InboundPreflight(
        msg=msg,
        sender_address=sender,
        auto_headers=headers,
        classification=classification,
        is_member=is_member,
    )


async def release_workspace_block(session, tenant, *, exclude_signal_id: str = "") -> int:
    """Clear a recorded LLM block and re-queue the threads deferred under it.

    Called after any successful model turn for the tenant; returns how many
    threads were re-queued.
    """
    from app.services.run_errors import LLM_BLOCK_SETTINGS_KEY, close_workspace_block

    if tenant is None:
        return 0
    try:
        has_block = LLM_BLOCK_SETTINGS_KEY in json.loads(tenant.settings_json or "{}")
    except (TypeError, json.JSONDecodeError):
        has_block = False
    if not has_block:
        return 0
    deferred = close_workspace_block(tenant)
    session.add(tenant)
    await session.commit()
    count = 0
    for sid in deferred:
        if sid == exclude_signal_id:
            continue
        await enqueue_signal_processing(str(tenant.id), sid)
        count += 1
    return count


async def process_inbound_signal(ctx, tenant_id: str, signal_id: str):
    """Run the assistant loop on a new inbound signal (email, widget, webhook, ...)."""
    from app.models.auth import Tenant
    from app.services import ai_handling

    async with async_session_factory() as session:
        signal_result = await session.execute(
            select(Signal).where(
                Signal.id == UUID(signal_id), Signal.tenant_id == UUID(tenant_id)
            )
        )
        signal = signal_result.scalar_one_or_none()
        if not signal:
            return {"skipped": True}

        # Workspace-wide LLM block (credits, key, spend cap): do not start a run
        # per message while it lasts; remember the thread and re-triage later.
        from app.services.run_errors import active_workspace_block, defer_signal_during_block

        tenant = await session.get(Tenant, UUID(tenant_id))
        blocked = active_workspace_block(tenant) if tenant is not None else None
        if blocked:
            defer_signal_during_block(tenant, signal.id)
            session.add(tenant)
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=UUID(tenant_id),
                    event_type="agent_deferred",
                    actor_type="system",
                    actor_id="",
                    payload_json=json.dumps(
                        {"block": blocked.get("kind"), "until": blocked.get("until")}
                    ),
                )
            )
            await session.commit()
            return {"skipped": True, "reason": f"blocked:{blocked.get('kind')}", "deferred": True}

        # Preflight only (no LLM). Interpretation is the channel agent's job.
        preflight = await _inbound_preflight(session, UUID(tenant_id), signal)
        if signal.superseded_by_id:
            newer = await session.get(Signal, signal.superseded_by_id)
            if newer is not None:
                signal = newer
                preflight = await _inbound_preflight(session, UUID(tenant_id), signal)

        from app.services.routing import resolve_inbound_agent_for_signal

        account, contact = await ai_handling.load_layers(session, UUID(tenant_id), signal)
        if signal.channel == "email" and account is None:
            return {"skipped": True, "reason": "mailbox_disconnected"}

        msg = preflight.msg
        if not msg:
            return {"skipped": True, "reason": "no inbound message"}

        auto_headers = preflight.auto_headers
        sender_address = preflight.sender_address

        # Learned inbox rules first: when the tenant already decided what to do
        # with this sender (auto-close, auto-task, skip AI) the rule handles the
        # thread directly — no agent run, no decision card.
        from app.services import inbox_rules

        tag_rules = await inbox_rules.find_tag_rules(
            session, UUID(tenant_id), sender_address, headers=auto_headers
        )
        await inbox_rules.apply_tag_rules(session, UUID(tenant_id), signal, tag_rules)
        rule = await inbox_rules.find_matching_rule(
            session, UUID(tenant_id), sender_address, headers=auto_headers
        )
        if rule:
            outcome = await inbox_rules.apply_rule_to_signal(
                session, UUID(tenant_id), signal, msg, rule
            )
            if signal.assignee_kind == "agent" and signal.status != "closed":
                await _hand_over_after_assist(session, signal, None, {"delivery": str(outcome)})
                await session.commit()
            return {"processed": True, "signal_id": signal_id, "delivery": outcome}

        if preflight.is_member:
            if signal.assignee_kind == "agent":
                await _hand_over_after_assist(session, signal, None, {"delivery": "workspace_member"})
                await session.commit()
            return {"skipped": True, "reason": "workspace_member"}

        from app.services.automated_mail import clip_with_ellipsis

        classification = preflight.classification
        if classification.get("automated"):
            from app.services.inbound_agent import acknowledge_automated_mail

            agent = await resolve_inbound_agent_for_signal(session, signal)
            preview = clip_with_ellipsis(msg.body_preview or msg.body_text or "")
            delivery = await acknowledge_automated_mail(
                session,
                UUID(tenant_id),
                signal,
                agent,
                summary=preview or signal.subject or "Automated notification; no reply needed.",
                reason=classification.get("reason") or "",
            )
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=UUID(tenant_id),
                    event_type="agent_processed",
                    actor_type="system",
                    actor_id="",
                    payload_json=json.dumps(
                        {"delivery": delivery, "automated_mail": classification["reason"]}
                    ),
                )
            )
            await _hand_over_after_assist(session, signal, agent, delivery)
            await session.commit()
            return {"processed": True, "signal_id": signal_id, "delivery": delivery}

        # Thread pin, channel agent, or the workspace lead.
        agent = await resolve_inbound_agent_for_signal(session, signal)
        if not agent:
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=UUID(tenant_id),
                    event_type="agent_processed",
                    actor_type="system",
                    actor_id="",
                    payload_json=json.dumps(
                        {"delivery": "skipped", "reason": "no_channel_agent"}
                    ),
                )
            )
            await session.commit()
            return {"skipped": True, "reason": "no_channel_agent"}

        # Match the composer: never draft/auto-send when the bound channel
        # cannot deliver. Still allow a read-only agent turn below when Manual.
        channel_not_ready = False
        channel_state = ""
        channel_state_reason = ""
        if (
            signal.channel in ("email", "slack", "whatsapp")
            and account is not None
        ):
            from app.services.channel_registry import can_send, resolve_channel

            row = resolve_channel(account, tenant=tenant)
            if not can_send(row):
                channel_not_ready = True
                channel_state = str(row.get("state") or "")
                channel_state_reason = str(row.get("state_reason") or "")

        handling = ai_handling.resolve_ai_handling(
            tenant, account, contact, signal, agent=agent
        )
        # Manual / held: agent still reads (summary, tags, ticket); no draft.
        read_only = (
            ai_handling.is_held(signal)
            or handling.effective == "manual"
            or channel_not_ready
        )
        run_mode = "assisted"
        if not read_only:
            run_mode, _downgrade = await ai_handling.apply_safeguards(
                session, tenant, signal, handling, contact=contact
            )
            if handling.effective == "assisted":
                run_mode = "assisted"
            if run_mode == "autonomous":
                # Sending on its own needs ownership: a person or team that
                # owns the conversation gets a draft instead. A person typing
                # in the composer right now also turns the send into a draft.
                gate_reason = autonomous_gate_reason(signal, agent)
                if gate_reason:
                    run_mode = "assisted"
                    session.add(
                        SignalEvent(
                            signal_id=signal.id,
                            tenant_id=UUID(tenant_id),
                            event_type="ai_handling_downgraded",
                            actor_type="system",
                            actor_id="",
                            payload_json=json.dumps(
                                {"from": "autonomous", "to": "assisted", "reason": gate_reason}
                            ),
                        )
                    )

        run = AgentRun(
            tenant_id=UUID(tenant_id),
            agent_id=agent.id,
            project_id=signal.project_id,
            trigger_type=signal.channel,
            trigger_id=signal_id,
            subject=f"{signal.channel.title()}: {signal.subject[:80]}",
            signal_id=signal.id,
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)
        from app.services.workforce_runtime import mark_agent_activity

        await mark_agent_activity(
            session,
            agent,
            status="working",
            summary=(signal.subject or "Replying")[:200],
            signal_id=signal.id,
            activity_id=run.id,
        )

        loop = AgentLoop(
            session, UUID(tenant_id), None, agent=agent, run=run, signal_id=signal.id
        )

        # Language policy: reply drafts mirror the customer's language (or a
        # pinned mailbox/tenant language); team-facing summaries follow the
        # workspace language. See services/language.py.
        from app.services.language import (
            reply_language_instruction,
            resolve_reply_language,
            resolve_workspace_language,
            workspace_language_instruction,
        )

        language_rules = (
            "Language rules:\n"
            f"- {reply_language_instruction(resolve_reply_language(tenant, account))}\n"
            f"- {workspace_language_instruction(resolve_workspace_language(tenant))}\n"
        )

        # Full message text: body_text can be a provider snippet for HTML-only
        # mail; message_plain_text falls back to the HTML-derived text.
        from app.services.signals import message_plain_text

        msg_text = message_plain_text(msg)

        # Conversation-driven projects: give the agent the project landscape so
        # it can recognize opportunities/bugs and feed the right project queue.
        project_context = ""
        try:
            from app.services.project_work import conversation_project_context

            snippet = await conversation_project_context(session, UUID(tenant_id), signal)
            if snippet:
                project_context = f"{snippet}\n"
        except Exception:  # noqa: BLE001 — context enrichment must never block replies
            project_context = ""

        # Same person on another channel this week (WhatsApp after email, a
        # colleague's reply from their own mailbox): the agent must not answer
        # what was already handled elsewhere.
        related_context = ""
        try:
            from app.services.related_conversations import recent_contact_context

            block = await recent_contact_context(session, signal)
            if block:
                related_context = f"{block}\n"
        except Exception:  # noqa: BLE001 — context enrichment must never block replies
            related_context = ""

        read_contract = (
            "0. Always read first: call get_contact when a contact is linked, use "
            "search_index / read_doc for relevant knowledge, then call "
            "record_thread_read once with a one-sentence summary, certainty 0-100, "
            "priority, and optional ticket_category / free tags from the catalog "
            "(list_categories / list_tags). When you learn a lasting fact about the "
            "person, update them with upsert_contact (notes or fields).\n"
        )

        if read_only:
            loop.tools = [t for t in loop.tools if t["name"] in MANUAL_READ_TOOLS]
            prompt = (
                f"New inbound {signal.channel} message from {msg.from_address or signal.contact_email}\n"
                f"Subject: {signal.subject}\n\n{msg_text}\n\n"
                "AI handling is Manual (or the channel cannot send): interpret only. "
                "Do not draft a customer reply and do not create a Send decision.\n"
                f"{read_contract}"
                "After record_thread_read (and any tags/ticket/contact updates), "
                "return exactly: Done.\n"
                f"{language_rules}"
                f"{project_context}"
                f"{related_context}"
            )
        elif run_mode == "assisted":
            # Assisted: research + thread read + inline decisions.
            # The final reply text becomes a DecisionRequest via
            # create_reply_suggestion — the agent can never send directly.
            loop.tools = [t for t in loop.tools if assisted_tool_allowed(t["name"])]
            module_reads = sorted(
                t["name"]
                for t in loop.tools
                if t["name"] not in SUGGEST_MODE_TOOLS
            )
            module_hint = (
                f"the module read tools ({', '.join(module_reads[:6])}) for records in "
                "connected business systems, "
                if module_reads
                else ""
            )
            prompt = (
                f"New inbound {signal.channel} message from {msg.from_address or signal.contact_email}\n"
                f"Subject: {signal.subject}\n\n{msg_text}\n\n"
                "You are preparing a response for a human teammate to review; "
                "nothing you produce is sent automatically.\n"
                f"{read_contract}"
                "1. Research: use search_index / read_doc for workspace knowledge, "
                "search_product_help for how Bokito itself works, "
                f"{module_hint}"
                "and call_mcp_tool only for other connected MCP servers "
                "when the question concerns records that live there.\n"
                "2. Then call exactly one tool and return exactly: Done.\n"
                "   - suggest_thread_reply with body_text = the customer-facing draft "
                "the human can approve, edit, or decline. The body must contain ONLY "
                "that text: start with the greeting (Hallo/Hoi/Hi), no research "
                "preamble, no meta commentary, no dividers. Do NOT write a sign-off "
                "or signature — the system appends it. Teammate notes go in the same "
                "body after a line that starts with exactly: INTERNAL_NOTE: . "
                "For customer email, never use relative /docs or /learn paths; paste "
                "the public_url from search_product_help as plain text "
                "(full https://app.bokito.ai/docs/... path including section). "
                "Prefer the help article over telling prospects to open Instellingen.\n"
                "   - create_decision_request when the human must choose between "
                "concrete alternatives (add an option with input_type \"text\" when a "
                "free-text answer is useful). Give every option a distinct id and "
                "label. Set action_type to a real tool name only when approving should "
                "run that tool. A reply option uses action_type \"send_reply\" with "
                "payload.body_text. Use escalate or acknowledge only for pure human "
                "takeover.\n"
                "   - note_no_reply with a one-line summary when the message is an "
                "automated notification that needs no reply (no-reply sender, "
                "newsletter, receipt, system alert).\n"
                "Do not return the draft as your final message. The tool call is the action.\n"
                f"{language_rules}"
                f"{project_context}"
                f"{related_context}"
                "Never invent facts about the customer's administration — if research "
                "returns nothing, say so in the draft and propose next steps."
            )
        else:
            prompt = (
                f"New inbound {signal.channel} message from {msg.from_address or signal.contact_email}\n"
                f"Subject: {signal.subject}\n\n{msg_text}\n\n"
                "Reply directly to the customer; your final message is delivered as-is. "
                f"{read_contract}"
                "Use tools for operational actions, or create_decision_request "
                "with multiple choice options when human input is required. "
                "If the message is an automated notification that needs no reply "
                "(no-reply sender, newsletter, receipt, system alert), do not reply; "
                "return exactly: NO_REPLY_NEEDED: <one-line summary of what it says>, "
                "as the only line, with no analysis before it.\n"
                f"{language_rules}"
                f"{project_context}"
                f"{related_context}"
            )
        try:
            reply_text, tokens = await loop.run_chat([{"role": "user", "content": prompt}])
        except Exception as exc:
            # Never leave the run stuck on "running": the agenda, cockpit and
            # workforce views all read this status.
            from app.services.run_errors import record_run_error, workspace_block

            run.status = "failed"
            run.completed_at = datetime.utcnow()
            record_run_error(run, exc)
            session.add(run)
            # A failed run must not leave the conversation parked on the agent.
            await _hand_over_after_assist(
                session, signal, agent, {"delivery": "run_failed"}, reason="run_failed"
            )
            await session.commit()
            from app.services.workforce_runtime import mark_agent_activity

            await mark_agent_activity(session, agent, status="standby")

            from app.services.task_ledger import settle_run_task

            await settle_run_task(session, run)

            block = workspace_block(exc)
            if block:
                # Spend cap / provider credits / bad key: every message fails the
                # same way until fixed. One alert, a thread note, no retry, and
                # a workspace block so the next messages are deferred instead
                # of each starting a doomed run.
                from app.services.ops_alerts import alert_workspace_block
                from app.services.run_errors import defer_signal_during_block, open_workspace_block

                if tenant is not None:
                    open_workspace_block(tenant, kind=block, error=exc)
                    defer_signal_during_block(tenant, signal.id)
                    session.add(tenant)
                session.add(
                    SignalEvent(
                        signal_id=signal.id,
                        tenant_id=UUID(tenant_id),
                        event_type="agent_blocked",
                        actor_type="system",
                        actor_id="",
                        payload_json=json.dumps({"block": block, "run_id": str(run.id)}),
                    )
                )
                await session.commit()
                await alert_workspace_block(session, UUID(tenant_id), block=block, error=exc)
                return {"skipped": True, "reason": block, "signal_id": signal_id}

            from app.services.ops_alerts import alert_run_failure

            await alert_run_failure(
                session,
                UUID(tenant_id),
                subject=run.subject or signal.subject or signal.channel,
                error=exc,
                run_id=run.id,
                signal_id=signal.id,
            )
            raise

        # The model answered: an expired block is over. Re-queue the threads
        # that were deferred while it lasted so nothing stays untriaged.
        await release_workspace_block(session, tenant, exclude_signal_id=str(signal.id))

        # If the agent already raised its own inline decision card during the
        # run, don't stack an automatic reply-suggestion card on top of it.
        tool_names = set(loop.turn.tool_names() if loop.turn else [])
        agent_created_decision = "create_decision_request" in tool_names
        agent_suggested_reply = "suggest_thread_reply" in tool_names
        agent_noted_no_reply = "note_no_reply" in tool_names

        from app.services.automated_mail import extract_no_reply_summary
        from app.services.inbound_agent import (
            acknowledge_channel_not_ready,
            create_action_suggestion,
            create_human_attention_suggestion,
            looks_like_empty_agent_ack,
            persist_inbound_agent_reply,
        )

        # Stale run: the contact wrote again while the agent was working. The
        # newer message has its own run; a card answering the older message
        # would only confuse the operator.
        newer_inbound = (
            await session.execute(
                select(SignalMessage.id)
                .where(
                    SignalMessage.signal_id == signal.id,
                    SignalMessage.direction == "inbound",
                    SignalMessage.kind == "user_message",
                    SignalMessage.author_user_id.is_(None),
                    SignalMessage.created_at > msg.created_at,
                    SignalMessage.id != msg.id,
                )
                .limit(1)
            )
        ).first()
        stale = (
            newer_inbound is not None
            and not read_only
            and run_mode == "assisted"
            and not agent_created_decision
            and not agent_suggested_reply
            and not agent_noted_no_reply
        )

        no_reply_summary = extract_no_reply_summary(reply_text)
        if read_only:
            if channel_not_ready:
                delivery = await acknowledge_channel_not_ready(
                    session,
                    UUID(tenant_id),
                    signal,
                    agent,
                    state=channel_state,
                    state_reason=channel_state_reason,
                )
            else:
                delivery = {
                    "read_only": True,
                    "delivery": "interpreted",
                    "reason": "ai_handling_manual",
                }
        elif stale:
            session.add(
                SignalEvent(
                    signal_id=signal.id,
                    tenant_id=UUID(tenant_id),
                    event_type="suggestion_skipped_stale",
                    actor_type="system",
                    actor_id="",
                    payload_json=json.dumps(
                        {"run_id": str(run.id), "trigger_message_id": str(msg.id)}
                    ),
                )
            )
            delivery = {"skipped": True, "reason": "stale", "delivery": "skipped_stale"}
        elif run_mode == "assisted" and (
            agent_suggested_reply or agent_noted_no_reply or agent_created_decision
        ):
            # The channel agent already filed the action as a tool call.
            delivery = {
                "via": "agent_tool",
                "delivery": (
                    "no_reply_needed"
                    if agent_noted_no_reply and not agent_suggested_reply
                    else "pending_decision"
                ),
                "tools": sorted(tool_names),
            }
        elif no_reply_summary is not None:
            # The model judged this an automated notification: suggest an
            # action (close / task / keep open) instead of sending a reply.
            delivery = await create_action_suggestion(
                session,
                UUID(tenant_id),
                signal,
                agent,
                summary=no_reply_summary,
                reason="agent_judgement",
                run_id=run.id,
            )
        elif run_mode == "assisted" and agent_created_decision:
            delivery = {"decision_created": True, "delivery": "pending_decision"}
        elif run_mode == "assisted" and looks_like_empty_agent_ack(reply_text):
            # Model returned Done. without create_decision_request — never leave
            # the operator with a silent empty timeline on real customer mail.
            delivery = await create_human_attention_suggestion(
                session,
                UUID(tenant_id),
                signal,
                agent,
                summary=(
                    "The agent did not produce a draft or choice card for this "
                    "message. Take over, or instruct the agent what to do next."
                ),
                run_id=run.id,
            )
        else:
            llm_live = bool(
                getattr(loop, "resolved_call", None)
                and getattr(loop.resolved_call, "live", False)
            )
            delivery = await persist_inbound_agent_reply(
                session,
                UUID(tenant_id),
                signal,
                agent,
                reply_text=reply_text,
                run_id=run.id,
                tokens=tokens,
                mode=run_mode,
                llm_live=llm_live,
                segments=list(loop.turn.segments) if loop.turn else None,
            )

        # The agent owned the conversation to prepare it. Nothing went to the
        # customer, so the next step is a person's: hand it to them now so it
        # shows in their queue instead of staying parked on the agent.
        if not stale:
            await _hand_over_after_assist(session, signal, agent, delivery)

        from app.services.workforce_runtime import mark_agent_activity

        await mark_agent_activity(session, agent, status="standby")
        run.status = "completed"
        run.completed_at = datetime.utcnow()
        if isinstance(tokens, dict):
            run.tokens_input = int(tokens.get("input_tokens") or 0)
            run.tokens_output = int(tokens.get("output_tokens") or 0)
        session.add(run)
        # Inbound runs that only replied were never promoted; ones that did
        # real work (module calls, mutations) carry a ledger Task to settle.
        from app.services.task_ledger import settle_run_task

        await settle_run_task(session, run)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=UUID(tenant_id),
                event_type="agent_processed",
                actor_type="agent",
                actor_id=str(agent.id),
                payload_json=json.dumps({"run_id": str(run.id), "delivery": delivery}),
            )
        )
        await session.commit()

        return {"processed": True, "signal_id": signal_id, "delivery": delivery}


async def coding_agent_run(ctx, tenant_id: str, task_subject: str, repo_path: str = "/work"):
    """V2 skeleton: coding agent run with sandbox placeholder."""
    async with async_session_factory() as session:
        agent_result = await session.execute(
            select(Agent).where(Agent.tenant_id == UUID(tenant_id), Agent.role == "coding").limit(1)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            return {"skipped": True}

        run = AgentRun(
            tenant_id=UUID(tenant_id),
            agent_id=agent.id,
            trigger_type="coding",
            subject=task_subject,
            result_json=json.dumps({"repo_path": repo_path, "status": "sandbox_pending"}),
        )
        session.add(run)
        await session.commit()
        event = RunEvent(
            run_id=run.id,
            tenant_id=UUID(tenant_id),
            event_type="sandbox",
            message=f"Coding run queued for repo at {repo_path} (V2 sandbox runner)",
        )
        session.add(event)
        run.status = "completed"
        run.completed_at = datetime.utcnow()
        await session.commit()
        return {"coding_run": str(run.id)}


async def advance_workstream_run_job(ctx, tenant_id: str, run_id: str):
    from app.services.workstreams import advance_run

    async with async_session_factory() as session:
        return await advance_run(session, UUID(tenant_id), UUID(run_id))


async def run_agent_task_segment_job(ctx, tenant_id: str, task_id: str):
    async with async_session_factory() as session:
        return await run_agent_task_segment(session, UUID(tenant_id), UUID(task_id))


_EMAIL_SYNC_FRESH_SECONDS = 45


def _mailbox_sync_is_fresh(settings_json: str | None) -> bool:
    """Skip enqueue when last_sync_at is within the freshness window."""
    if not settings_json:
        return False
    try:
        data = json.loads(settings_json)
    except json.JSONDecodeError:
        return False
    if not isinstance(data, dict):
        return False
    raw = data.get("last_sync_at")
    if not raw or not isinstance(raw, str):
        return False
    try:
        # Accept both naive UTC and offset-aware ISO strings.
        stamp = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if stamp.tzinfo is not None:
            stamp = stamp.replace(tzinfo=None)
    except ValueError:
        return False
    age = (datetime.utcnow() - stamp).total_seconds()
    return age < _EMAIL_SYNC_FRESH_SECONDS


async def sync_email_mailboxes_job(ctx):
    """Dispatcher: enqueue one sync job per enabled mailbox (skip if freshly synced)."""
    if os.environ.get("EMAIL_SYNC_ENABLED", "true").lower() in ("0", "false", "no", "off"):
        return {"skipped": True, "reason": "disabled"}

    redis = ctx.get("redis")
    async with async_session_factory() as session:
        result = await session.execute(
            select(ChannelAccount.id, ChannelAccount.settings_json).where(
                ChannelAccount.channel == "email",
                ChannelAccount.is_enabled.is_(True),
                ChannelAccount.provider.in_(("gmail", "outlook", "smtp_imap")),
            )
        )
        rows = list(result.all())

    enqueued = 0
    skipped_fresh = 0
    for account_id, settings_json in rows:
        if _mailbox_sync_is_fresh(settings_json):
            skipped_fresh += 1
            continue
        if redis is not None:
            await redis.enqueue_job("sync_email_account_job", str(account_id))
            enqueued += 1
        else:
            # Cron context without redis (tests): run inline.
            await sync_email_account_job(ctx, str(account_id))
            enqueued += 1
    return {
        "accounts": len(rows),
        "enqueued": enqueued,
        "skipped_fresh": skipped_fresh,
    }


async def sync_email_account_job(ctx, account_id: str):
    """Poll one Gmail/Outlook/SMTP mailbox and ingest new messages."""
    from app.services.email_sync import sync_account

    if os.environ.get("EMAIL_SYNC_ENABLED", "true").lower() in ("0", "false", "no", "off"):
        return {"skipped": True, "reason": "disabled"}

    async with async_session_factory() as session:
        result = await session.execute(
            select(ChannelAccount).where(ChannelAccount.id == UUID(account_id))
        )
        account = result.scalar_one_or_none()
        if not account:
            return {"account_id": account_id, "synced": 0, "status": "missing"}
        if (
            account.channel != "email"
            or not account.is_enabled
            or account.provider not in ("gmail", "outlook", "smtp_imap")
        ):
            return {"account_id": account_id, "synced": 0, "status": "skipped"}
        if _mailbox_sync_is_fresh(account.settings_json):
            return {"account_id": account_id, "synced": 0, "status": "fresh"}
        try:
            return await sync_account(session, account)
        except Exception as exc:  # noqa: BLE001 — isolate per-account failures
            return {
                "account_id": account_id,
                "synced": 0,
                "status": f"error:{exc}",
            }


async def send_tenant_digests_job(ctx):
    """Daily digest mails at 06:00 UTC; weekly digests fire on Mondays."""
    from app.services.digest_mail import send_tenant_digests

    async with async_session_factory() as session:
        daily = await send_tenant_digests(session, period="daily")
        weekly = 0
        if datetime.utcnow().weekday() == 0:
            weekly = await send_tenant_digests(session, period="weekly")
    return {"daily": daily, "weekly": weekly}


async def index_project_repo_job(ctx, tenant_id: str, project_id: str):
    """Index a project's connected GitHub repo into the vector pipeline."""
    from app.services.repo_index import index_project_repo

    async with async_session_factory() as session:
        return await index_project_repo(session, UUID(tenant_id), UUID(project_id))


async def deliver_webhook_job(ctx, delivery_id: str):
    """Deliver one outbound webhook (HMAC-signed, with in-task retries)."""
    from app.models.webhook import WebhookDelivery
    from app.services.webhooks import perform_delivery

    async with async_session_factory() as session:
        result = await session.execute(
            select(WebhookDelivery).where(WebhookDelivery.id == UUID(delivery_id))
        )
        delivery = result.scalar_one_or_none()
        if not delivery or delivery.status != "pending":
            return {"skipped": True}
        delivery = await perform_delivery(session, delivery)
        return {"status": delivery.status, "status_code": delivery.status_code}


async def index_module_source_job(ctx, source_id: str):
    """Fetch and index one ModuleSource URL into workspace docs."""
    from app.services.module_sources import index_source

    async with async_session_factory() as session:
        row = await index_source(session, UUID(source_id))
        return {"id": str(row.id), "status": row.status}


async def reindex_module_sources_job(ctx):
    """Weekly cron: reindex platform + auto_reindex tenant module sources."""
    from app.services.module_sources import reindex_due_sources

    async with async_session_factory() as session:
        count = await reindex_due_sources(session)
        return {"reindexed": count}


async def workbench_poll_job(ctx):
    """Poll active workbench jobs for providers without reliable push."""
    from app.services.workbench.gateway import poll_active_jobs

    async with async_session_factory() as session:
        count = await poll_active_jobs(session)
        return {"refreshed": count}


async def sync_calendar_connections_job(ctx):
    """Poll Google / Outlook calendar connections into CalendarEvent rows."""
    from sqlalchemy import select

    from app.models.integration import IntegrationConnection
    from app.services.calendar_sync import _calendar_slug, sync_connection

    async with async_session_factory() as session:
        result = await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.status == "active",
            )
        )
        synced = 0
        errors = 0
        for conn in result.scalars().all():
            if _calendar_slug(conn) is None:
                continue
            try:
                out = await sync_connection(session, conn)
                if out.get("status") == "error":
                    errors += 1
                else:
                    synced += 1
            except Exception:
                errors += 1
        return {"connections": synced, "errors": errors}


async def nudge_idle_agent_sessions_job(ctx):
    """Offer a checkout on inline agent sessions the operator walked away from."""
    from app.services.agent_sessions import nudge_idle_sessions

    async with async_session_factory() as session:
        return await nudge_idle_sessions(session)


async def purge_retention_job(ctx):
    """Daily: Bin TTL first, then privacy message/calendar retention."""
    from sqlalchemy import select

    from app.models.auth import Tenant
    from app.services.privacy import purge_expired_for_tenant
    from app.services.trash import purge_expired_trash

    async with async_session_factory() as session:
        tenants = (await session.execute(select(Tenant))).scalars().all()
        totals = {"messages_deleted": 0, "calendar_deleted": 0, "trash_purged": 0, "tenants": 0}
        for tenant in tenants:
            try:
                totals["trash_purged"] += await purge_expired_trash(session, tenant)
                out = await purge_expired_for_tenant(session, tenant)
                totals["messages_deleted"] += out.get("messages_deleted", 0)
                totals["calendar_deleted"] += out.get("calendar_deleted", 0)
                totals["tenants"] += 1
            except Exception:
                continue
        return totals


class WorkerSettings:
    # Triggers + learning are scheduled by the in-process API scheduler
    # (app.services.trigger_scheduler); the worker only handles queued jobs
    # and mailbox polling.
    functions = [
        process_inbound_signal,
        coding_agent_run,
        run_agent_task_segment_job,
        advance_workstream_run_job,
        sync_email_mailboxes_job,
        sync_email_account_job,
        sync_calendar_connections_job,
        purge_retention_job,
        deliver_webhook_job,
        index_project_repo_job,
        index_module_source_job,
        reindex_module_sources_job,
        nudge_idle_agent_sessions_job,
        workbench_poll_job,
    ]
    on_startup = startup
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    # Poll mailboxes every minute (replaces the former in-process API scheduler poll).
    cron_jobs = [
        cron(sync_email_mailboxes_job, second=0),
        cron(sync_calendar_connections_job, minute={0, 15, 30, 45}),
        cron(purge_retention_job, hour=4, minute=20),
        cron(send_tenant_digests_job, hour=6, minute=0),
        cron(reindex_module_sources_job, weekday=0, hour=3, minute=15),
        cron(nudge_idle_agent_sessions_job, second=30),
        cron(workbench_poll_job, second={0, 30}),
    ]


_arq_pool = None
_arq_pool_unavailable = False


async def _get_arq_pool():
    """Reuse one ARQ Redis pool across enqueue helpers (API process lifespan).

    When Redis is down, remember the failure so every enqueue does not spend
    another multi-second retry loop (tests and local API without Redis).
    """
    global _arq_pool, _arq_pool_unavailable
    if _arq_pool_unavailable:
        raise RuntimeError("ARQ Redis unavailable")
    if _arq_pool is None:
        from dataclasses import replace

        # from_dsn defaults to 5 connect retries; that stalls pytest and MCP
        # install when localhost Redis is not running.
        redis_settings = replace(
            RedisSettings.from_dsn(settings.redis_url),
            conn_timeout=1,
            conn_retries=0,
            conn_retry_delay=0,
        )
        try:
            _arq_pool = await create_pool(redis_settings)
        except Exception:
            _arq_pool_unavailable = True
            raise
    return _arq_pool


async def close_arq_pool() -> None:
    global _arq_pool, _arq_pool_unavailable
    if _arq_pool is not None:
        await _arq_pool.close()
        _arq_pool = None
    _arq_pool_unavailable = False


async def assignment_should_wake_agent(session, signal) -> bool:
    """An agent just became owner of an open external thread that still needs a reply.

    A run already in progress for this conversation is left alone.
    """
    from sqlalchemy import select

    from app.models.agent import AgentRun
    from app.models.signal import EXTERNAL_CHANNELS, SignalMessage

    if signal.assignee_kind != "agent" or not signal.agent_id:
        return False
    if signal.status != "open" or signal.channel not in EXTERNAL_CHANNELS:
        return False
    last = (
        await session.execute(
            select(SignalMessage.direction)
            .where(
                SignalMessage.signal_id == signal.id,
                SignalMessage.kind.in_(("user_message", "agent_message")),
            )
            .order_by(SignalMessage.created_at.desc())
            .limit(1)
        )
    ).first()
    if last is None or last.direction != "inbound":
        return False
    running = (
        await session.execute(
            select(AgentRun.id)
            .where(
                AgentRun.tenant_id == signal.tenant_id,
                AgentRun.trigger_id == str(signal.id),
                AgentRun.status == "running",
            )
            .limit(1)
        )
    ).first()
    return running is None


async def enqueue_signal_processing(tenant_id: str, signal_id: str):
    try:
        redis = await _get_arq_pool()
        await redis.enqueue_job("process_inbound_signal", tenant_id, signal_id)
    except Exception as exc:  # noqa: BLE001
        # Worker unavailable (local dev without Redis): fall back to in-process
        # processing so inbound AI flows still work without infrastructure.
        import asyncio
        import logging

        from app.services.runtime_health import record_redis_enqueue_failure

        logging.getLogger(__name__).warning(
            "Redis unavailable, processing inbound signal %s in-process: %s",
            signal_id,
            exc,
        )
        record_redis_enqueue_failure(f"inbound_signal: {exc}")

        async def _inline() -> None:
            try:
                await process_inbound_signal(None, tenant_id, signal_id)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception(
                    "In-process signal processing failed for %s", signal_id
                )

        asyncio.create_task(_inline())
        return


async def enqueue_repo_index(tenant_id: str, project_id: str):
    try:
        redis = await _get_arq_pool()
        await redis.enqueue_job("index_project_repo_job", tenant_id, project_id)
    except Exception as exc:  # noqa: BLE001
        # No Redis (local dev): index in-process so the flow still works.
        import asyncio
        import logging

        from app.services.runtime_health import record_redis_enqueue_failure

        logging.getLogger(__name__).warning(
            "Redis unavailable, indexing repo for project %s in-process: %s", project_id, exc
        )
        record_redis_enqueue_failure(f"repo_index: {exc}")

        async def _inline() -> None:
            try:
                await index_project_repo_job(None, tenant_id, project_id)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception(
                    "In-process repo indexing failed for project %s", project_id
                )

        asyncio.create_task(_inline())
        return


async def enqueue_webhook_delivery(delivery_id: str):
    try:
        redis = await _get_arq_pool()
        await redis.enqueue_job("deliver_webhook_job", delivery_id)
    except Exception as exc:  # noqa: BLE001
        # No Redis (local dev): deliver in-process so webhooks still fire.
        import asyncio
        import logging

        from app.services.runtime_health import record_redis_enqueue_failure

        logging.getLogger(__name__).warning(
            "Redis unavailable, delivering webhook %s in-process: %s", delivery_id, exc
        )
        record_redis_enqueue_failure(f"webhook_delivery: {exc}")

        async def _inline() -> None:
            try:
                await deliver_webhook_job(None, delivery_id)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception(
                    "In-process webhook delivery failed for %s", delivery_id
                )

        asyncio.create_task(_inline())
        return


async def enqueue_module_source_index(source_id: str):
    try:
        redis = await _get_arq_pool()
        await redis.enqueue_job("index_module_source_job", source_id)
    except Exception as exc:  # noqa: BLE001
        import asyncio
        import logging

        from app.services.runtime_health import record_redis_enqueue_failure

        logging.getLogger(__name__).warning(
            "Redis unavailable, indexing module source %s in-process: %s", source_id, exc
        )
        record_redis_enqueue_failure(f"module_source_index: {exc}")

        async def _inline() -> None:
            try:
                await index_module_source_job(None, source_id)
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception(
                    "In-process module source indexing failed for %s", source_id
                )

        asyncio.create_task(_inline())
        return
