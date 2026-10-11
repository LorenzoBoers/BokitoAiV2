"""Built-in tool implementations, registered into the unified registry."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models.auth import Tenant
from app.models.notification import DecisionRequest, Notification
from app.services.addressee import parse_target
from app.services.os_graph import OS_GRAPH_RETIRED
from app.services.signal_decisions import (
    find_open_duplicate_decision,
    recently_declined_decision,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool

TO_TARGET_SCHEMA = {
    "type": "string",
    "description": (
        "Optional: who to ask. 'user:<email>' or 'team:<team name>'. "
        "Leave empty to follow the agent's Ask questions to setting."
    ),
}

PROPOSAL_ITEMS_SCHEMA = {
    "type": "array",
    "description": (
        "Showcase cards inside your message (EntityRow previews). Prefer #name "
        "for tags in prose. Types: conversation | trash_entry | trigger | file | "
        "image | user | agent | tag | flow | project | contact | integration | "
        "marketplace | module | help_doc | message. Pass id (tag: name; file: "
        "message_id + name/index; image: https url in url or id; "
        "marketplace/module/help_doc: slug or path). "
        "Example: items:[{type:\"project\", id:\"<project_id>\"}] or "
        "[{type:\"image\", url:\"https://…\", title:\"…\"}]."
    ),
    "items": {
        "type": "object",
        "properties": {
            "type": {"type": "string"},
            "id": {"type": "string"},
            "name": {"type": "string"},
            "url": {"type": "string"},
            "image_url": {"type": "string"},
            "title": {"type": "string"},
            "message_id": {"type": "string"},
            "index": {"type": "integer"},
        },
        "required": ["type"],
    },
}


async def _get_tenant(ctx: ToolContext) -> Tenant:
    result = await ctx.session.execute(select(Tenant).where(Tenant.id == ctx.tenant_id))
    return result.scalar_one()


# ── workspace / knowledge ────────────────────────────────────────


async def _search_index(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import hybrid_search

    results = await hybrid_search(
        ctx.session, ctx.tenant_id, tool_input.get("query", ""), tool_input.get("top_k", 8)
    )
    return {"results": results}


async def _web_search(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.web_search import brave_search

    return await brave_search(
        str(tool_input.get("query") or ""),
        count=int(tool_input.get("count") or 5),
        kind=str(tool_input.get("kind") or "web"),
    )


async def _search_product_help(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.product_help import search_product_help

    results = await search_product_help(
        tool_input.get("query", ""),
        top_k=int(tool_input.get("top_k") or 5),
    )
    return {"results": results}


async def _remember_about_me(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.user_memory import upsert_user_memory

    if not ctx.user_id:
        return {"error": "No person in this session to remember anything about"}
    key = str(tool_input.get("key") or "").strip()
    if not key:
        return {"error": "key is required"}
    entry = await upsert_user_memory(
        ctx.session, ctx.user_id, key, str(tool_input.get("content") or "")
    )
    if entry is None:
        return {"forgotten": key}
    return {"remembered": entry.key, "content": entry.content}


async def _list_docs(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import list_docs, serialize_doc

    project_id = None
    agent_id = None
    raw_project = str(tool_input.get("project_id") or "").strip()
    raw_agent = str(tool_input.get("agent_id") or "").strip()
    if raw_project:
        try:
            project_id = UUID(raw_project)
        except ValueError:
            return {"error": "project_id must be a valid id"}
    elif ctx.project_id:
        project_id = ctx.project_id
    if raw_agent:
        try:
            agent_id = UUID(raw_agent)
        except ValueError:
            return {"error": "agent_id must be a valid id"}
    scope = tool_input.get("scope")
    docs = await list_docs(
        ctx.session,
        ctx.tenant_id,
        kind=tool_input.get("kind"),
        project_id=project_id,
        agent_id=agent_id,
        scope=str(scope) if scope else None,
    )
    return {"docs": [serialize_doc(d, include_content=False) for d in docs]}


async def _read_doc(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import get_doc_by_path, serialize_doc

    doc = await get_doc_by_path(ctx.session, ctx.tenant_id, tool_input["path"])
    if not doc:
        return {"error": f"Doc {tool_input['path']} not found"}
    return serialize_doc(doc)


async def _platform_change(
    ctx: ToolContext,
    *,
    resource_type: str,
    change_kind: str,
    summary: str,
    after: dict[str, Any],
    before: dict[str, Any] | None = None,
    tool_name: str,
) -> dict[str, Any]:
    from app.services.platform_changes import propose_platform_change

    tenant = await _get_tenant(ctx)
    change, meta = await propose_platform_change(
        ctx.session,
        tenant,
        resource_type=resource_type,
        change_kind=change_kind,
        after=after,
        before=before,
        summary=summary,
        agent=ctx.agent,
        run_id=ctx.run_id,
        user_id=ctx.user_id,
        tool_name=tool_name,
        mode=ctx.mode,
        signal_id=ctx.signal_id,
        bundle_id=ctx.bundle_id,
    )
    if meta.get("mode") == "apply":
        return meta.get("applied", {"status": "applied", "mode": "apply"})
    return {
        "change_id": str(change.id),
        # The card id lets the turn attach this ask to the agent's bubble.
        "decision_request_id": str(change.decision_id) if change.decision_id else None,
        "status": change.status,
        "mode": meta.get("mode"),
        "message": "Change submitted for review",
    }


async def _workstream_run_id(ctx: ToolContext) -> UUID | None:
    """The workstream run behind the current agent run, when there is one."""
    if not ctx.run_id:
        return None
    from app.models.agent import AgentRun

    return (
        await ctx.session.execute(
            select(AgentRun.workstream_run_id).where(AgentRun.id == ctx.run_id)
        )
    ).scalar_one_or_none()


async def _write_doc(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import (
        SECTION_MAX_WORDS,
        SECTION_SPLIT_HINT,
        get_doc_by_path,
        split_markdown_sections,
        word_count,
    )

    path = tool_input["path"]
    mode = tool_input.get("mode", "append")
    section = str(tool_input.get("section") or "").strip()
    content = tool_input["content"]
    # Knowledge skill enforcement: agents keep sections small (one topic,
    # roughly 150-400 words). Oversized writes come back with a split hint.
    if ctx.agent is not None:
        if section:
            if word_count(content) > SECTION_MAX_WORDS:
                return {"error": SECTION_SPLIT_HINT}
        else:
            oversized = [
                heading or "(intro)"
                for heading, body in split_markdown_sections(content)
                if word_count(body) > SECTION_MAX_WORDS
            ]
            if oversized:
                return {
                    "error": f"{SECTION_SPLIT_HINT} Oversized sections: {', '.join(oversized[:5])}"
                }
    # Project-scoped runs write project docs by default (smart documentation).
    project_id = str(tool_input.get("project_id") or "").strip() or (
        str(ctx.project_id) if ctx.project_id else None
    )
    agent_id = str(tool_input.get("agent_id") or "").strip() or None
    existing = await get_doc_by_path(ctx.session, ctx.tenant_id, path)
    before = None
    if existing:
        before = {"path": existing.path, "content": existing.content, "kind": existing.kind}
        if existing.project_id:
            project_id = str(existing.project_id)
        if getattr(existing, "agent_id", None):
            agent_id = str(existing.agent_id)
    # Run-context rule: autonomous agent writes to project docs go through
    # workstream runs only. A human live in the session (user_id set), a
    # human-gated proposal (mode "ask"), and non-project docs stay direct.
    run_ref = await _workstream_run_id(ctx)
    if (
        ctx.agent is not None
        and ctx.user_id is None
        and ctx.mode == "apply"
        and project_id
        and run_ref is None
    ):
        return {
            "error": (
                "Project docs are agent-editable only inside a workstream run. "
                "Route this work through a project workstream (a queue item or "
                "manual run) instead of writing directly."
            )
        }
    target = f"{path} § {section}" if section else path
    return await _platform_change(
        ctx,
        resource_type="workspace_doc",
        change_kind="update" if existing else "create",
        summary=f"{'Update' if existing else 'Create'} workspace doc {target}",
        after={
            "path": path,
            "content": content,
            "mode": mode if existing else ("replace" if not section else mode),
            "section": section or None,
            "kind": tool_input.get("kind"),
            "project_id": project_id,
            "agent_id": agent_id,
            "workstream_run_id": str(run_ref) if run_ref else None,
        },
        before=before,
        tool_name="write_doc",
    )


# ── messaging / decisions ────────────────────────────────────────


async def _send_reply(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Send a reply on an external signal thread (used by approved suggestion decisions).

    Email/Slack replies are delivered via the channel provider; widget/chat
    replies reach the visitor live via the gateway publish.
    """
    from datetime import datetime

    from app.channels.outbound import deliver_outbound
    from app.gateway.publish import publish_signal_message
    from app.models.signal import Signal, SignalEvent, SignalMessage

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}
    if signal.channel in ("internal", "assistant"):
        return {"error": f"Channel {signal.channel} has no external party to reply to"}

    body_text = str(tool_input.get("body_text") or tool_input.get("body") or "").strip()
    if not body_text and isinstance(tool_input.get("messages"), list):
        body_text = "\n\n".join(
            m.strip() for m in tool_input["messages"] if isinstance(m, str) and m.strip()
        )
    body_html = tool_input.get("body_html")
    if isinstance(body_html, str) and not body_html.strip():
        body_html = None
    if not body_text and not body_html:
        return {"error": "body_text or body_html required"}
    if not body_text and body_html:
        body_text = body_html

    # Safety net: relative /docs links and markdown must not leave the mailbox.
    if signal.channel == "email":
        from app.services.suggestion_format import format_customer_email_body

        plain, html = format_customer_email_body(body_text)
        body_text = plain or body_text
        if not body_html:
            body_html = html

    subject = str(tool_input.get("subject") or "").strip()
    if not subject:
        subject = f"Re: {signal.subject}" if signal.subject else "Reply"

    to_override = str(tool_input.get("to") or "").strip()
    if to_override and not signal.contact_email:
        signal.contact_email = to_override

    # Sender identity: "user" (human approved — the default for approvals) or
    # "agent" (auto mode, or explicitly chosen). It drives the appended
    # signature, From display name, and timeline attribution; the From
    # address stays the mailbox (technical requirement of the connected account).
    send_as = str(tool_input.get("send_as") or "").strip().lower()
    if send_as not in ("user", "agent"):
        send_as = "agent" if ctx.agent else "user"
    identity_agent_id = ctx.agent.id if ctx.agent else signal.agent_id
    if send_as == "user" and not ctx.user_id:
        send_as = "agent"

    from app.services.signatures import resolve_from_display_name, resolve_signature_html

    signature_html = await resolve_signature_html(
        ctx.session,
        ctx.tenant_id,
        send_as=send_as,
        user_id=ctx.user_id,
        agent_id=identity_agent_id,
        channel_account_id=signal.channel_account_id,
    )
    from_display_name = await resolve_from_display_name(
        ctx.session,
        ctx.tenant_id,
        send_as=send_as,
        user_id=ctx.user_id,
        agent_id=identity_agent_id,
    )

    from app.services.agent.reply_mode import format_for_channel
    from app.services.chat_delivery import messages_from_payload, pause_before

    # Chat channels: an approved multi-bubble draft goes out as separate
    # messages, in order, with a short typing pause in between.
    if signal.channel == "email":
        bubbles = [body_text]
    else:
        bubbles = [
            format_for_channel(b, signal.channel) for b in messages_from_payload(tool_input)
        ] or [format_for_channel(body_text, signal.channel)]

    as_user = send_as == "user"
    sent: list[SignalMessage] = []
    delivery = "skipped"
    for index, text in enumerate(bubbles):
        if index:
            await pause_before(text)
        single_html = body_html if isinstance(body_html, str) and len(bubbles) == 1 else None
        delivery_result = await deliver_outbound(
            ctx.session,
            signal,
            body_text=text,
            subject=subject,
            body_html=single_html,
            signature_html=signature_html,
            from_display_name=from_display_name,
        )
        delivery = delivery_result.status
        if delivery == "skipped":
            # Channels without provider delivery (widget/chat): the visitor
            # receives the message live via the gateway publish below.
            delivery = "sent"
        if not delivery.startswith("sent"):
            if not sent:
                return {"error": f"Delivery failed: {delivery}", "delivery": delivery}
            break

        metadata: dict[str, Any] = {
            "source": "send_reply_tool",
            "delivery": delivery,
            "send_as": send_as,
        }
        if from_display_name:
            metadata["from_display_name"] = from_display_name
        if ctx.user_id:
            # Keep the approving human traceable even on agent-identity sends.
            metadata["approved_by_user_id"] = str(ctx.user_id)
        if len(bubbles) > 1:
            metadata["bubble_index"] = index
        now = datetime.utcnow()
        message = SignalMessage(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            kind="user_message" if as_user else "agent_message",
            direction="outbound",
            role="user" if as_user else "assistant",
            author_agent_id=None if as_user else identity_agent_id,
            author_user_id=ctx.user_id if as_user else None,
            from_address=delivery_result.from_address,
            to_addresses=delivery_result.to_address or signal.contact_email or "",
            external_id=delivery_result.provider_message_id,
            subject=subject,
            body_text=text,
            body_html=delivery_result.body_html or single_html or "",
            body_preview=text[:200],
            send_status=delivery,
            auto_sent=False,
            received_at=now,
            metadata_json=json.dumps(metadata),
        )
        ctx.session.add(message)
        signal.last_message_at = now
        signal.updated_at = now
        ctx.session.add(signal)
        await ctx.session.flush()
        await publish_signal_message(signal, message)
        sent.append(message)

    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="replied",
            actor_type="user" if as_user else "agent",
            actor_id=str(ctx.user_id if as_user else identity_agent_id or ""),
            payload_json=json.dumps(
                {
                    "delivery": delivery,
                    "via": "send_reply",
                    "send_as": send_as,
                    "messages": len(sent),
                }
            ),
        )
    )
    await ctx.session.flush()
    out: dict[str, Any] = {
        "ok": True,
        "delivery": sent[-1].send_status,
        "message_id": str(sent[-1].id),
        "signal_id": str(signal.id),
    }
    if len(bubbles) > 1:
        out["message_ids"] = [str(m.id) for m in sent]
        if len(sent) < len(bubbles):
            out["partial"] = True
            out["last_delivery"] = delivery
    return out


def _target_signal_id(ctx: ToolContext, tool_input: dict[str, Any]) -> UUID | None:
    """Thread a messaging tool acts on: explicit input, else the call's thread."""
    raw = tool_input.get("signal_id")
    if raw:
        try:
            return UUID(str(raw))
        except ValueError:
            return ctx.signal_id
    return ctx.signal_id


async def _suggest_thread_reply(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Propose a customer-facing reply on a thread; the operator approves it.

    The proposal lands as the thread's reply-suggestion card, so a draft an
    agent offers while sparring with an operator goes through the same
    approve / edit / decline path as an inbound AI suggestion.
    """
    from app.models.signal import Signal
    from app.services.inbound_agent import create_reply_suggestion

    signal_id = _target_signal_id(ctx, tool_input)
    if not signal_id:
        return {"error": "signal_id required"}
    if not ctx.agent:
        return {"error": "Only an agent can suggest a reply"}

    body_text = str(tool_input.get("body_text") or tool_input.get("body") or "").strip()
    if not body_text:
        return {"error": "body_text required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}
    if signal.channel in ("internal", "assistant"):
        return {"error": f"Channel {signal.channel} has no external party to reply to"}

    outcome = await create_reply_suggestion(
        ctx.session, ctx.tenant_id, signal, ctx.agent, reply_text=body_text
    )
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "awaiting_approval": True,
        "note": (
            "The draft is waiting as a suggested reply on the conversation. "
            "Tell the teammate it is ready to review; nothing was sent."
        ),
        **outcome,
    }


async def _note_no_reply(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Record that an inbound message needs no customer reply.

    Assisted inbound uses this instead of a magic final line. The operator
    still gets the no-reply card on the thread.
    """
    from app.models.signal import Signal
    from app.services.inbound_agent import create_action_suggestion

    signal_id = _target_signal_id(ctx, tool_input)
    if not signal_id:
        return {"error": "signal_id required"}
    if not ctx.agent:
        return {"error": "Only an agent can note that no reply is needed"}
    summary = str(tool_input.get("summary") or "").strip()
    if not summary:
        return {"error": "summary required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}

    outcome = await create_action_suggestion(
        ctx.session,
        ctx.tenant_id,
        signal,
        ctx.agent,
        summary=summary,
        reason="agent_judgement",
        run_id=ctx.run_id,
    )
    return {"ok": True, "awaiting_approval": True, **outcome}


async def _propose_session_checkout(
    ctx: ToolContext, tool_input: dict[str, Any]
) -> dict[str, Any]:
    """Offer to wrap up the inline session you are working in.

    The card lands on the host conversation so the whole team sees how the
    session ended. Ending is the operator's call: this tool only proposes.
    """
    from app.services.agent.style import strip_emoji
    from app.services.agent_sessions import propose_checkout, resolve_active_session

    signal_id = _target_signal_id(ctx, tool_input)
    if not signal_id:
        return {"error": "signal_id required"}

    conversation = await resolve_active_session(
        ctx.session,
        ctx.tenant_id,
        signal_id,
        agent_id=ctx.agent.id if ctx.agent else None,
    )
    if conversation is None:
        return {"error": "No active agent session on this conversation"}

    summary = strip_emoji(str(tool_input.get("summary") or "")).strip()
    if not summary:
        return {"error": "summary required"}

    return await propose_checkout(
        ctx.session,
        ctx.tenant_id,
        conversation,
        summary=summary,
        options=tool_input.get("options"),
        user_id=ctx.user_id,
    )


async def _take_over_conversation(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Continue the customer conversation yourself: become its handling agent.

    The mirror image of ``handoff_to_human``: AI replies resume on the thread
    and this agent is pinned as the one that answers the next inbound
    message, so an operator can hand a conversation back mid-sparring.
    """
    from datetime import datetime

    from app.gateway.publish import publish_thread_update
    from app.models.signal import Signal, SignalEvent

    signal_id = _target_signal_id(ctx, tool_input)
    if not signal_id:
        return {"error": "signal_id required"}
    if not ctx.agent:
        return {"error": "Only an agent can take over a conversation"}
    if getattr(ctx.agent, "kind", "company") != "company":
        return {
            "error": "Only a company agent can handle a customer conversation",
        }

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}
    if signal.channel in ("internal", "assistant"):
        return {"error": f"Channel {signal.channel} has no external party to converse with"}

    from app.services.ai_handling import (
        REASON_ESCALATED,
        REASON_HANDOFF,
        conversation_mode,
        release_conversation,
    )

    # Customer/visitor handoff holds the thread until a human acts. Agents must
    # not silently resume AI after "talk to a human".
    if conversation_mode(signal) == "manual" and (signal.ai_handling_reason or "") in (
        REASON_HANDOFF,
        REASON_ESCALATED,
    ):
        return {
            "error": (
                "AI handling is manual because the customer asked for a human. "
                "A team member must reply or hand the thread back to AI."
            ),
            "ai_handling": "manual",
            "signal_id": str(signal.id),
        }

    from app.services.handover import hand_to_agent

    # Pin this agent on the thread; it becomes the owner only when it may
    # send on its own (autonomous, channel can send). Otherwise the current
    # owner keeps the conversation and this agent drafts for them.
    signal.agent_id = ctx.agent.id
    signal.updated_at = datetime.utcnow()
    if conversation_mode(signal) == "manual":
        release_conversation(
            ctx.session,
            signal,
            reason=str(tool_input.get("reason") or "").strip(),
            actor_type="agent",
            actor_id=str(ctx.agent.id),
            via="take_over_conversation",
        )
    became_owner = await hand_to_agent(
        ctx.session,
        None,
        signal,
        actor_type="agent",
        actor_id=str(ctx.agent.id),
        via="take_over_conversation",
        agent=ctx.agent,
    )
    ctx.session.add(signal)
    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="agent_assigned",
            actor_type="agent",
            actor_id=str(ctx.agent.id),
            payload_json=json.dumps(
                {
                    "via": "take_over_conversation",
                    "agent_id": str(ctx.agent.id),
                    "agent_name": ctx.agent.name,
                    "reason": str(tool_input.get("reason") or "").strip(),
                }
            ),
        )
    )
    await ctx.session.flush()
    await publish_thread_update(signal)
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "ai_handling": None,
        "handling_agent": ctx.agent.name,
        "owner": "agent" if became_owner else (signal.assignee_kind or "team"),
        "note": (
            "You now own this conversation and send the next reply yourself."
            if became_owner
            else (
                "You handle the next inbound message, but AI handling here is not "
                "autonomous: the current owner keeps the conversation and you draft "
                "replies for their approval."
            )
        ),
    }


async def _close_thread(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Close a signal thread without replying (mark it resolved).

    Used by approved action-suggestion decisions on automated/no-reply mail,
    and available to agents as a governed mutation.
    """
    from datetime import datetime

    from app.gateway.publish import publish_thread_update
    from app.models.signal import Signal, SignalEvent

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    # SQLite demo rows can store UUID PKs in a form that fails GUID bind compares.
    if signal is None and signal_id is not None:
        from sqlalchemy import String, cast

        result = await ctx.session.execute(
            select(Signal).where(
                cast(Signal.id, String) == str(signal_id),
                Signal.tenant_id == ctx.tenant_id,
            )
        )
        signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}
    if signal.status == "closed":
        return {"ok": True, "signal_id": str(signal.id), "status": "closed", "already_closed": True}

    from app.services.ai_handling import on_status_change

    signal.status = "closed"
    signal.has_unread = False
    on_status_change(
        ctx.session, signal, actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or "")
    )
    from app.services.tickets import settle_ticket_on_close

    await settle_ticket_on_close(
        ctx.session,
        signal,
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    signal.updated_at = datetime.utcnow()
    ctx.session.add(signal)
    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="thread_updated",
            actor_type="agent" if ctx.agent else "user",
            actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
            payload_json=json.dumps(
                {"status": "closed", "via": "close_thread", "note": tool_input.get("note") or ""}
            ),
        )
    )
    await ctx.session.flush()
    await publish_thread_update(signal)
    from app.services.webhooks import emit_webhook_event, signal_event_data

    await emit_webhook_event(ctx.session, ctx.tenant_id, "signal.closed", signal_event_data(signal))
    return {"ok": True, "signal_id": str(signal.id), "status": "closed"}


async def _mark_handled_externally(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Log that a conversation was settled outside Bokito (call, personal
    WhatsApp, another mailbox). Same gate as close_thread."""
    from app.services.signal_threads import HANDLED_EXTERNALLY_CHANNELS, mark_handled_externally

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}
    channel = str(tool_input.get("channel") or "other").strip().lower()
    if channel not in HANDLED_EXTERNALLY_CHANNELS:
        return {"error": f"channel must be one of {', '.join(HANDLED_EXTERNALLY_CHANNELS)}"}
    actor_user_id = ctx.user_id
    if actor_user_id is None:
        # Autonomous run: the thread owner or the agent's creator stands in as actor.
        from app.models.signal import Signal

        owner = (
            await ctx.session.execute(
                select(Signal.assigned_user_id).where(
                    Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id
                )
            )
        ).scalar_one_or_none()
        actor_user_id = owner or getattr(ctx.agent, "owner_user_id", None)
    if actor_user_id is None:
        return {"error": "No person to attribute this to; ask a team member to log it."}
    message = await mark_handled_externally(
        ctx.session,
        ctx.tenant_id,
        actor_user_id,
        signal_id,
        channel=channel,
        note=str(tool_input.get("note") or ""),
        close=bool(tool_input.get("close", False)),
        language=str(tool_input.get("language") or ""),
        actor_agent_id=ctx.agent.id if ctx.agent else None,
        actor_name=str(getattr(ctx.agent, "name", "") or "") if ctx.agent else "",
    )
    if not message:
        return {"error": "Signal not found"}
    return {
        "ok": True,
        "signal_id": str(signal_id),
        "channel": channel,
        "closed": bool(tool_input.get("close", False)),
        "message_id": message.get("id"),
    }


async def _record_thread_read(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Persist the agent's inbound read: summary, priority, certainty, tags, ticket."""
    from app.services.interpretation import apply_thread_read
    from app.services.signals import get_triage_context, message_plain_text
    from app.models.signal import SignalMessage

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            return {"error": "signal_id must be an id"}
    if not signal_id:
        return {"error": "signal_id required"}

    summary = str(tool_input.get("summary") or "").strip()
    if not summary:
        return {"error": "summary is required (one sentence)"}

    body_quote = ""
    try:
        ctx_row = await get_triage_context(ctx.session, ctx.tenant_id, signal_id)
        body_quote = str(ctx_row.get("body") or "")[:200]
    except Exception:  # noqa: BLE001
        msg = (
            await ctx.session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == signal_id,
                    SignalMessage.direction == "inbound",
                )
                .order_by(SignalMessage.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if msg is not None:
            body_quote = message_plain_text(msg)[:200]

    unknown = tool_input.get("unknown_signal")
    tags = tool_input.get("tags")
    if not isinstance(tags, list):
        tags = None

    try:
        result = await apply_thread_read(
            ctx.session,
            ctx.tenant_id,
            signal_id,
            summary=summary,
            certainty=int(tool_input.get("certainty") or 50),
            category=str(tool_input.get("category") or "other"),
            urgency=int(tool_input.get("urgency") or 50),
            impact=int(tool_input.get("impact") or 40),
            priority=str(tool_input.get("priority") or "normal"),
            intent=str(tool_input.get("intent") or "") or None,
            sentiment=str(tool_input.get("sentiment") or "") or None,
            ticket_category=str(tool_input.get("ticket_category") or ""),
            tags=tags,
            unknown_signal=unknown if isinstance(unknown, dict) else None,
            agent_id=ctx.agent.id if ctx.agent else None,
            agent_name=str(getattr(ctx.agent, "name", "") or "") if ctx.agent else None,
            body_quote=body_quote,
        )
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
    return {
        "ok": True,
        "signal_id": str(signal_id),
        "summary": result.get("summary"),
        "priority": result.get("priority"),
        "certainty": result.get("certainty"),
        "category": result.get("category"),
    }


async def _set_thread_tags(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Add tags to a signal thread from the tenant's tag registry.

    Union merge only: agents never remove operator tags, and can only apply
    tags that are registered (same constraint as AI triage).
    """
    from datetime import datetime

    from app.gateway.publish import publish_thread_update
    from app.models.signal import Signal, SignalEvent
    from app.services.signal_tags import add_signal_tags, allowed_tag_names, normalize_tag

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    requested = tool_input.get("tags")
    if not isinstance(requested, list) or not requested:
        return {"error": "tags must be a non-empty list of strings"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}

    create_missing = bool(tool_input.get("create_missing"))
    catalog = set(await allowed_tag_names(ctx.session, ctx.tenant_id))
    allowed: list[str] = []
    rejected: list[str] = []
    for raw in requested:
        name = normalize_tag(raw) if isinstance(raw, str) else ""
        if not name:
            continue
        (allowed if (name in catalog or create_missing) else rejected).append(name)
    if not allowed:
        return {
            "error": (
                "None of the requested tags exist in the tag registry. Pass "
                "create_missing=true (or call create_tag first) to add new free tags."
            ),
            "rejected": rejected,
            "catalog": sorted(catalog)[:30],
        }

    tags, added = await add_signal_tags(
        ctx.session, ctx.tenant_id, signal.id, allowed, registered_only=not create_missing
    )
    if added:
        signal.updated_at = datetime.utcnow()
        ctx.session.add(signal)
        ctx.session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=ctx.tenant_id,
                event_type="thread_updated",
                actor_type="agent" if ctx.agent else "user",
                actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
                payload_json=json.dumps({"tags": tags, "via": "set_thread_tags"}),
            )
        )
        await ctx.session.flush()
        await publish_thread_update(signal, tags=tags)
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "added": added,
        "tags": tags,
        "rejected": rejected,
    }


async def _handoff_to_human(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Escalate a conversation to the team: set AI handling to manual, alert operators.

    The visitor keeps chatting in the same thread; a team member takes over
    from the inbox (the manual conversation override silences the agent until
    someone hands it back).
    """
    from app.models.signal import Signal
    from app.services.handoff import request_human_handoff

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}

    reason = str(tool_input.get("reason") or "").strip()
    await request_human_handoff(
        ctx.session,
        ctx.tenant_id,
        signal,
        reason=reason,
        via="handoff_to_human",
        to=await parse_target(ctx.session, ctx.tenant_id, tool_input.get("to")),
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "ai_handling": "manual",
        "note": (
            "The team has been notified and AI replies are paused on this thread. "
            "Tell the visitor a team member will take over in this same conversation."
        ),
    }


async def _continue_on_whatsapp(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Give the visitor a WhatsApp link that carries this chat over."""
    from app.models.auth import Tenant
    from app.models.signal import Signal
    from app.services.whatsapp_handover import create_handover

    if not ctx.signal_id:
        return {"error": "continue_on_whatsapp only works inside a website chat"}
    signal = await ctx.session.get(Signal, ctx.signal_id)
    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    if signal is None or tenant is None or signal.tenant_id != ctx.tenant_id:
        return {"error": "Conversation not found"}
    result = await create_handover(ctx.session, tenant, signal, language=str(tool_input.get("language") or ""))
    if result.get("error"):
        return result
    await ctx.session.commit()
    return {
        **result,
        "instruction": (
            "Give the visitor this link as a markdown link, for example [Continue on WhatsApp](link). "
            "Tell them the message is filled in already; they only press send."
        ),
    }


async def _request_callback(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Ask the team to get back later without pausing the chat."""
    from app.models.signal import Signal
    from app.services.handoff import request_callback

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    if not signal_id:
        return {"error": "signal_id required"}

    result = await ctx.session.execute(
        select(Signal).where(Signal.id == signal_id, Signal.tenant_id == ctx.tenant_id)
    )
    signal = result.scalar_one_or_none()
    if not signal:
        return {"error": "Signal not found"}

    reason = str(tool_input.get("reason") or "").strip()
    await request_callback(
        ctx.session,
        ctx.tenant_id,
        signal,
        reason=reason,
        via="request_callback",
        to=await parse_target(ctx.session, ctx.tenant_id, tool_input.get("to")),
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "note": (
            "The team has been notified to get back later. Chat stays open. "
            "Tell the visitor the team is away and will follow up in this conversation."
        ),
    }


async def _request_customer_verify(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.customer_verify import request_customer_verify

    signal_id = ctx.signal_id
    raw_signal = tool_input.get("signal_id")
    if raw_signal:
        try:
            signal_id = UUID(str(raw_signal))
        except ValueError:
            pass
    email = str(tool_input.get("email") or "").strip()
    return await request_customer_verify(
        ctx.session, ctx.tenant_id, signal_id=signal_id, email=email
    )


NON_EXECUTABLE_ACTIONS = frozenset(
    {"escalate", "acknowledge", "defer", "reject", "dismiss", "later", "ignore", "none", ""}
)

# Actions the decision resolver executes itself (no registered tool behind
# them) and that still do something without a conversation.
RESOLVER_ACTIONS = frozenset(
    {
        "setup_integration",
        "enable_module",
        "activate_inbox_rule",
        "add_module_source",
        "accept_platform_change",
        "contact_link",
        "contact_create",
        "calendar_create_event",
        "calendar_update_event",
        # Generic module proposal cards record the approval itself.
        "approve",
    }
)


def executable_option_actions(options: list[dict[str, Any]]) -> list[str]:
    """Action types in ``options`` that approving would actually run.

    A registered tool name or a resolver action counts; escalate /
    acknowledge / defer / reject only make sense when the card sits on a
    thread a human can take over.
    """
    from app.tools.registry import get_tool_spec

    found: list[str] = []
    for option in options:
        if not isinstance(option, dict):
            continue
        action = str(option.get("action_type") or "").strip().lower()
        if option.get("input_type") == "text":
            # A free-text answer is captured; that is the point of the card.
            action = action or "text"
            if action not in found:
                found.append(action)
            continue
        if action in NON_EXECUTABLE_ACTIONS or action in found:
            continue
        if action in RESOLVER_ACTIONS or get_tool_spec(action) is not None:
            found.append(action)
    return found


async def resolve_signal_by_subject(session, tenant_id: UUID, subject: str) -> UUID | None:
    """The most recent open conversation whose subject contains ``subject``."""
    from app.models.signal import Signal

    needle = subject.strip()
    if len(needle) < 3:
        return None
    row = (
        await session.execute(
            select(Signal.id)
            .where(
                Signal.tenant_id == tenant_id,
                Signal.deleted_at.is_(None),
                Signal.status.in_(("open", "pending", "snoozed")),
                Signal.subject.ilike(f"%{needle}%"),
            )
            .order_by(Signal.last_message_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return row


async def _create_decision_request(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent.style import strip_emoji

    # Agent-generated copy: keep titles/summaries emoji-free platform-wide.
    tool_input = {
        **tool_input,
        "title": strip_emoji(str(tool_input.get("title", ""))) or "Decision needed",
        "summary": strip_emoji(str(tool_input.get("summary", ""))),
    }
    raw_signal = tool_input.get("signal_id") or (str(ctx.signal_id) if ctx.signal_id else None)
    target_signal_id: UUID | None = None
    if raw_signal:
        try:
            target_signal_id = UUID(str(raw_signal))
        except ValueError:
            target_signal_id = None
    if target_signal_id is None and str(tool_input.get("thread_subject") or "").strip():
        # Heartbeat and scheduled runs have no thread of their own; when the
        # question is about a conversation, attach the card to that thread so
        # the operator sees the ask next to the message instead of in an
        # orphan internal thread.
        target_signal_id = await resolve_signal_by_subject(
            ctx.session, ctx.tenant_id, str(tool_input["thread_subject"])
        )
    if target_signal_id is None:
        executable = executable_option_actions(tool_input.get("options") or [])
        if not executable:
            # Nothing a click could run: an "acknowledge" card without a thread
            # is just a note. Put it in the report instead of the decision list.
            return {
                "ok": False,
                "code": "no_executable_option",
                "message": (
                    "Not raised as a decision: the card has no thread and none of its "
                    "options runs a platform tool. Mention the observation in your "
                    "report instead, or pass signal_id / thread_subject so the card "
                    "lands on the conversation it concerns."
                ),
            }
    if target_signal_id:
        # A newer identical ask supersedes the stale card: without this the
        # thread stacks duplicate pending decisions every time the customer
        # writes again before anyone resolved the previous draft.
        from datetime import datetime

        stale_query = select(DecisionRequest).where(
            DecisionRequest.tenant_id == ctx.tenant_id,
            DecisionRequest.signal_id == target_signal_id,
            DecisionRequest.status == "awaiting_human",
            DecisionRequest.platform_change_id.is_(None),
            DecisionRequest.title == tool_input["title"],
        )
        if ctx.bundle_id:
            # Cards of the same turn form one bundle; they never replace each other.
            stale_query = stale_query.where(DecisionRequest.bundle_id != ctx.bundle_id)
        stale_result = await ctx.session.execute(stale_query)
        for stale in stale_result.scalars().all():
            stale.status = "deferred"
            stale.resolved_at = datetime.utcnow()
            stale.chosen_option_id = "superseded"
            ctx.session.add(stale)
            if stale.notification_id:
                # The bell must not keep counting a card nobody can act on.
                stale_notif = (
                    await ctx.session.execute(
                        select(Notification).where(Notification.id == stale.notification_id)
                    )
                ).scalar_one_or_none()
                if stale_notif and stale_notif.status == "unread":
                    stale_notif.status = "read"
                    ctx.session.add(stale_notif)
    else:
        # Cards without a thread (heartbeat wakes, scheduled runs) used to pile
        # up: one tenant collected 34 identical "Turn on Banking?" cards, each
        # in its own internal thread. Same title + same primary action while a
        # previous ask is still open means the question is already on the table.
        duplicate = await find_open_duplicate_decision(
            ctx.session,
            ctx.tenant_id,
            title=tool_input["title"],
            options=tool_input.get("options") or [],
        )
        if duplicate is not None:
            return {
                "decision_request_id": str(duplicate.id),
                "status": "already_open",
                "message": (
                    "This question is already waiting for a human decision. "
                    "Do not ask again; mention it at most once in your summary."
                ),
            }
    project_uuid = None
    raw_project = tool_input.get("project_id")
    if raw_project:
        try:
            project_uuid = UUID(str(raw_project))
        except ValueError:
            project_uuid = None
    from app.services.signal_decisions import create_decision

    # Provenance: the card names the run and, when the run executes a queue
    # item, the AgentTask behind it. The task lives on the run, so one lookup
    # covers every caller instead of threading a task id through the executor.
    task_uuid: UUID | None = None
    if ctx.run_id:
        from app.models.agent import AgentRun

        run_row = (
            await ctx.session.execute(select(AgentRun).where(AgentRun.id == ctx.run_id))
        ).scalar_one_or_none()
        if run_row:
            task_uuid = run_row.task_id

    from app.services.proposal_items import resolve_items

    raw_items = tool_input.get("items")
    items = await resolve_items(ctx.session, ctx.tenant_id, raw_items if isinstance(raw_items, list) else None)
    question = strip_emoji(str(tool_input.get("question") or "")).strip() or None
    selection = str(tool_input.get("selection") or "single").strip().lower()
    if selection not in ("single", "multiple"):
        selection = "single"
    asker_id = ctx.agent.id if ctx.agent else None
    decision, _ = await create_decision(
        ctx.session,
        ctx.tenant_id,
        title=tool_input["title"],
        summary=tool_input.get("summary", ""),
        options=tool_input.get("options", []),
        user_id=ctx.user_id,
        agent_id=asker_id,
        signal_id=target_signal_id,
        project_id=project_uuid,
        agent_task_id=task_uuid,
        run_id=ctx.run_id,
        source_id=str(asker_id) if asker_id else None,
        notification_payload={k: v for k, v in tool_input.items() if k != "items"},
        to=await parse_target(ctx.session, ctx.tenant_id, tool_input.get("to")),
        items=items,
        question=question,
        selection=selection,
        bundle_id=ctx.bundle_id,
    )
    await ctx.session.commit()
    result: dict[str, Any] = {"decision_request_id": str(decision.id), "status": "awaiting_human"}
    missing = [item for item in items if item.get("missing")]
    if missing:
        result["missing_items"] = [{"type": i["type"], "id": i["id"]} for i in missing]
    return result


PROPOSAL_COOLDOWN_DAYS = 7


async def proposal_cooldown(ctx: ToolContext, title: str) -> dict[str, Any] | None:
    """Block a proposal card a human declined recently (module, integration, source).

    Returns the tool result to hand back to the agent, or None when the
    proposal may be raised.
    """
    declined = await recently_declined_decision(
        ctx.session, ctx.tenant_id, title=title, within_days=PROPOSAL_COOLDOWN_DAYS
    )
    if declined is None:
        return None
    when = declined.resolved_at.date().isoformat() if declined.resolved_at else "recently"
    return {
        "ok": False,
        "code": "recently_declined",
        "decision_request_id": str(declined.id),
        "message": (
            f"A human answered '{declined.status}' to this proposal on {when}. "
            f"Do not propose it again within {PROPOSAL_COOLDOWN_DAYS} days."
        ),
    }


async def _suggest_integration(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.integrations_catalog import PROVIDER_BY_SLUG

    provider = str(tool_input["provider"])
    catalog = PROVIDER_BY_SLUG.get(provider)
    display_name = catalog["name"] if catalog else provider.replace("_", " ").title()
    blocked = await proposal_cooldown(ctx, f"Connect {display_name}?")
    if blocked:
        return blocked
    options = [
        {"id": "connect", "label": "Connect now", "action_type": "setup_integration", "payload": tool_input},
        {"id": "later", "label": "Later", "action_type": "defer"},
    ]
    return await _create_decision_request(
        ctx,
        {
            "title": f"Connect {display_name}?",
            "summary": tool_input.get("reason", ""),
            "signal_id": tool_input.get("signal_id"),
            "options": options,
        },
    )


async def _search_repo(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Hybrid search over indexed repository files (optionally one project)."""
    from uuid import UUID as _UUID

    from app.services.repo_index import search_repo_chunks

    query = str(tool_input.get("query") or "").strip()
    if not query:
        return {"error": "query required"}
    project_id = ctx.project_id
    raw_project = str(tool_input.get("project_id") or "").strip()
    if raw_project:
        try:
            project_id = _UUID(raw_project)
        except ValueError:
            return {"error": "invalid project_id"}
    results = await search_repo_chunks(
        ctx.session, ctx.tenant_id, query, project_id=project_id, top_k=6
    )
    if not results:
        return {
            "results": [],
            "note": "No indexed repository content matched. Connect a repo on the project and run reindex first.",
        }
    return {
        "results": [
            {"path": r["path"], "title": r["title"], "score": r["score"], "content": r["content"]}
            for r in results
        ]
    }


async def _suggest_inbox_rule(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Propose an inbox automation rule (learned from a correction or pattern).

    The rule lands as *suggested*; a human activates it from Inbox settings
    (Automation rules) or an inline card. Never activates anything itself.
    """
    from app.services.inbox_rules import (
        RULE_ACTIONS,
        normalize_match_value,
        raise_rule_decision,
        suggest_rule,
    )

    match_type = str(tool_input.get("match_type") or "sender")
    match_value = str(tool_input.get("match_value") or "")
    action = str(tool_input.get("action") or "")
    if match_type not in ("sender", "domain", "list_id"):
        return {"error": "match_type must be one of sender, domain, list_id."}
    if action not in RULE_ACTIONS:
        return {"error": f"action must be one of {', '.join(RULE_ACTIONS)}."}
    if not normalize_match_value(match_type, match_value):
        hint = {
            "sender": "a full email address (name@domain.tld)",
            "domain": "a bare domain (domain.tld)",
            "list_id": "the List-Id header value (list.domain.tld)",
        }[match_type]
        return {"error": f"match_value for {match_type} must be {hint}; got {match_value!r}."}

    payload = await suggest_rule(
        ctx.session,
        ctx.tenant_id,
        match_type=match_type,
        match_value=match_value,
        action=action,
        label=str(tool_input.get("label") or ""),
        source="agent",
        reason=str(tool_input.get("reason") or ""),
    )
    if payload is None:
        return {
            "error": (
                "Rule not suggested: a rule for this sender already exists "
                "(active or paused)."
            )
        }
    # In a conversation the question is asked inline, where the operator
    # already is; elsewhere the suggestion waits under Automation rules.
    raised = None
    if ctx.signal_id:
        raised = await raise_rule_decision(
            ctx.session,
            ctx.tenant_id,
            payload,
            signal_id=ctx.signal_id,
            agent_id=ctx.agent.id if ctx.agent else None,
            summary=str(tool_input.get("reason") or ""),
        )
    await ctx.session.commit()
    return {
        "rule": payload,
        "decision": raised,
        "confirm_path": "/settings/channels#automation-rules",
        "note": (
            "Suggested only — the operator must activate it. "
            + (
                "An inline card now asks them on this thread; do not repeat the question."
                if raised
                else "Tell them with an in-app markdown link, e.g. "
                "[Automation rules](/settings/channels#automation-rules). "
                "Do not write plain breadcrumbs like Inbox > Automation rules."
            )
        ),
    }


async def _propose_integration(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    return await _suggest_integration(
        ctx,
        {
            "provider": tool_input["provider"],
            "reason": tool_input.get("reason", ""),
            "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
        },
    )


async def _create_task(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from datetime import datetime, timedelta
    from uuid import UUID

    from app.services.agent.style import strip_emoji
    from app.services.orchestration.dispatcher import create_agent_task

    title = strip_emoji(str(tool_input.get("title", ""))) or "Follow up"
    workstream_id = UUID(str(tool_input["workstream_id"])) if tool_input.get("workstream_id") else None
    requested_agent = UUID(str(tool_input["agent_id"])) if tool_input.get("agent_id") else None
    peer = requested_agent and (not ctx.agent or requested_agent != ctx.agent.id)

    # On a conversation without a playbook/peer: a human task on that thread
    # (Agenda). Same AgentTask ledger as agent jobs.
    if ctx.signal_id and not workstream_id and not peer:
        when = datetime.utcnow() + timedelta(hours=4)
        task = await create_agent_task(
            ctx.session,
            ctx.tenant_id,
            title=title,
            description=tool_input.get("description", ""),
            signal_id=ctx.signal_id,
            project_id=UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else ctx.project_id,
            created_by=ctx.user_id,
            kind="task",
            origin="conversation",
            assignee_kind="human",
            assignee_user_id=ctx.user_id,
            scheduled_for=when,
            auto_start=False,
        )
        return {
            "kind": "task",
            "task_id": str(task.id),
            "signal_id": str(task.signal_id) if task.signal_id else None,
            "scheduled_for": task.scheduled_for.isoformat() if task.scheduled_for else None,
            "status": task.status,
            "assignee_kind": "human",
        }

    agent_id = requested_agent or (ctx.agent.id if ctx.agent else None)
    task = await create_agent_task(
        ctx.session,
        ctx.tenant_id,
        title=title,
        description=tool_input.get("description", ""),
        agent_id=agent_id,
        project_id=UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else ctx.project_id,
        workstream_id=workstream_id,
        signal_id=ctx.signal_id,
        created_by=ctx.user_id,
        auto_start=tool_input.get("auto_start", True),
    )
    return {
        "kind": "job",
        "task_id": str(task.id),
        "signal_id": str(task.signal_id) if task.signal_id else None,
        "status": task.status,
    }


async def _delegate_to_agent(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID

    from sqlalchemy import select

    from app.models.agent import Agent
    from app.services.orchestration.dispatcher import create_agent_task

    target: Agent | None = None
    if tool_input.get("agent_id"):
        target = (
            await ctx.session.execute(
                select(Agent).where(
                    Agent.id == UUID(str(tool_input["agent_id"])),
                    Agent.tenant_id == ctx.tenant_id,
                    Agent.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
    elif tool_input.get("agent_slug"):
        target = (
            await ctx.session.execute(
                select(Agent).where(
                    Agent.slug == tool_input["agent_slug"],
                    Agent.tenant_id == ctx.tenant_id,
                    Agent.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
    if not target:
        return {"error": "Target agent not found in this tenant"}

    from app.services.agent.style import strip_emoji

    instructions = tool_input.get("instructions") or tool_input.get("message") or ""
    title = strip_emoji(str(tool_input.get("title") or "")) or f"Delegated to {target.name}"
    task = await create_agent_task(
        ctx.session,
        ctx.tenant_id,
        title=title,
        description=instructions,
        agent_id=target.id,
        project_id=UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else None,
        workstream_id=UUID(str(tool_input["workstream_id"])) if tool_input.get("workstream_id") else None,
        signal_id=ctx.signal_id,
        created_by=ctx.user_id,
        auto_start=tool_input.get("auto_start", True),
    )
    return {
        "task_id": str(task.id),
        "agent_id": str(target.id),
        "agent_name": target.name,
        "signal_id": str(task.signal_id) if task.signal_id else None,
        "status": task.status,
    }


async def _propose_agent_rule(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Suggest a rule for yourself; a person confirms it inline before it applies."""
    from fastapi import HTTPException

    from app.models.auth import Tenant
    from app.services.agent_rules import propose_rule

    if ctx.agent is None:
        return {"error": "Only agents can propose rules for themselves"}
    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    if tenant is None:
        return {"error": "Workspace not found"}
    rule = {
        "text": tool_input.get("text"),
        "mode": tool_input.get("mode"),
        "kind": tool_input.get("kind") or "judgement",
        "tool": tool_input.get("tool") or "",
        "category": tool_input.get("category") or "",
    }
    try:
        return await propose_rule(
            ctx.session,
            tenant,
            rule=rule,
            agent=ctx.agent,
            proposer_agent=ctx.agent,
            signal_id=ctx.signal_id,
        )
    except HTTPException as exc:
        return {"error": str(exc.detail)}


async def _assign_conversation(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Hand the current conversation to another agent or a team, with an optional message."""
    import json as _json
    from datetime import datetime

    from app.gateway.publish import publish_signal_message, publish_thread_update
    from app.models.signal import Signal, SignalEvent, SignalMessage
    from app.services.ai_handling import on_assignment_change
    from app.services.ownership import owner_payload, resolve_assignee, set_owner
    from app.services.thread_dispatch import dispatch_to

    if not ctx.signal_id:
        return {"error": "assign_conversation only works inside a conversation"}
    kind = str(tool_input.get("kind") or "")
    if kind not in ("agent", "team"):
        return {"error": "kind must be agent or team"}
    signal = await ctx.session.get(Signal, ctx.signal_id)
    if signal is None or signal.tenant_id != ctx.tenant_id:
        return {"error": "Conversation not found"}
    try:
        owner_id = await resolve_assignee(ctx.session, ctx.tenant_id, signal, kind, tool_input.get("id"))
    except ValueError as exc:
        return {"error": str(exc)}
    if ctx.agent is not None and kind == "agent" and owner_id == ctx.agent.id:
        return {"error": "This conversation is already yours"}
    before = owner_payload(signal)
    before_assignee = signal.assigned_user_id
    set_owner(signal, kind, owner_id, by_user_id=ctx.user_id)
    on_assignment_change(
        ctx.session,
        signal,
        before_assignee=before_assignee,
        before_kind=before["kind"],
        actor_id=str(ctx.agent.id) if ctx.agent is not None else "",
    )
    ctx.session.add(signal)
    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="assigned",
            actor_type="agent" if ctx.agent is not None else "user",
            actor_id=str(ctx.agent.id) if ctx.agent is not None else str(ctx.user_id or ""),
            payload_json=_json.dumps({"before": before, "after": owner_payload(signal)}),
        )
    )
    message_text = str(tool_input.get("message") or "").strip()
    note: SignalMessage | None = None
    if message_text and ctx.agent is not None:
        note = SignalMessage(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            kind="internal_note",
            direction="internal",
            role="assistant",
            author_agent_id=ctx.agent.id,
            from_address="",
            to_addresses="",
            subject=signal.subject,
            body_text=message_text,
            body_preview=message_text[:200],
            body_html=f"<p>{message_text}</p>",
            metadata_json=_json.dumps({"agent_name": ctx.agent.name, "handover": True}),
            received_at=datetime.utcnow(),
        )
        ctx.session.add(note)
    await ctx.session.commit()
    await publish_thread_update(signal)
    if note is not None:
        await ctx.session.refresh(note)
        await publish_signal_message(signal, note)
    result = {"assigned_to": {"kind": kind, "id": str(owner_id)}}
    if message_text and ctx.user_id:
        result["dispatch"] = await dispatch_to(
            ctx.session,
            ctx.tenant_id,
            signal,
            kind=kind,
            target_id=owner_id,
            author_user_id=ctx.user_id,
            author_name=ctx.agent.name if ctx.agent is not None else "",
            text=message_text,
            user_role=ctx.user_role or "member",
        )
    return result


# ── integrations ─────────────────────────────────────────────────


async def _call_mcp_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent.mcp_client import call_mcp_tool
    from app.services.connection_scope import mcp_server_denial, record_denial

    agent_id = ctx.agent.id if ctx.agent is not None else None
    denial = await mcp_server_denial(
        ctx.session,
        ctx.tenant_id,
        str(tool_input.get("server_name") or ""),
        agent_id=agent_id,
        project_id=ctx.project_id,
    )
    if denial is not None:
        await record_denial(
            ctx.session,
            ctx.tenant_id,
            agent_id=agent_id,
            connection_id=denial[0],
            reason=denial[1],
            action="tool_call:call_mcp_tool",
        )
        return {"error": denial[1], "status": "denied", "reason": "connection_scope"}
    return await call_mcp_tool(ctx.session, ctx.tenant_id, tool_input)


# ── platform mutations (agents / graph / integrations) ──────────


async def _snapshot_before(
    ctx: ToolContext, resource_type: str, change_kind: str, after: dict[str, Any]
) -> dict[str, Any] | None:
    if change_kind not in ("update", "delete"):
        return None
    if resource_type == "agent" and after.get("agent_id"):
        from app.models.agent import Agent as AgentModel

        row = (
            await ctx.session.execute(
                select(AgentModel).where(
                    AgentModel.id == UUID(str(after["agent_id"])),
                    AgentModel.tenant_id == ctx.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row:
            return {
                "agent_id": str(row.id),
                "name": row.name,
                "role": row.role,
                "system_prompt": row.system_prompt,
            }
    if resource_type == "workstream" and after.get("workstream_id"):
        from app.models.orchestra import Workstream
        from app.services.workstreams import serialize_workstream

        row = (
            await ctx.session.execute(
                select(Workstream).where(
                    Workstream.id == UUID(str(after["workstream_id"])),
                    Workstream.tenant_id == ctx.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row:
            return serialize_workstream(row)
    if resource_type == "category" and after.get("tag_id"):
        from app.models.signal import SignalTag
        from app.services.tickets import serialize_category

        try:
            row = await ctx.session.get(SignalTag, UUID(str(after["tag_id"])))
        except ValueError:
            row = None
        if row is not None and row.tenant_id == ctx.tenant_id:
            return serialize_category(row)
    return None


def _make_platform_handler(tool_name: str, resource_type: str, change_kind: str, summary_fn):
    async def handler(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
        before = await _snapshot_before(ctx, resource_type, change_kind, tool_input)
        return await _platform_change(
            ctx,
            resource_type=resource_type,
            change_kind=change_kind,
            summary=summary_fn(tool_input),
            after=tool_input,
            before=before,
            tool_name=tool_name,
        )

    return handler


# ── registrations ────────────────────────────────────────────────

register_tool(
    ToolSpec(
        name="search_index",
        description="Hybrid search (vector + keyword) over workspace docs, memory, and skills.",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}, "top_k": {"type": "integer"}},
            "required": ["query"],
        },
        handler=_search_index,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="web_search",
        description=(
            "Search the open web (Brave Search). Use for current facts, news, or "
            "public pages outside this workspace. kind=web returns titles, urls, "
            "snippets; kind=images returns image urls. To show images in chat, "
            "call attach_items with type image and each result's image_url. "
            "Prefer search_index / search_product_help for Bokito and workspace data."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "count": {
                    "type": "integer",
                    "description": "Number of results (1-10, default 5)",
                },
                "kind": {
                    "type": "string",
                    "enum": ["web", "images"],
                    "description": "web (default) or images",
                },
            },
            "required": ["query"],
        },
        handler=_web_search,
        mutating=False,
        gated=False,
        audience="both",
        display_name="Web search",
    )
)

register_tool(
    ToolSpec(
        name="search_product_help",
        description=(
            "Search Bokito product-help articles (how to use the platform). "
            "Use this when the user asks how a Bokito page, setting, or workflow works. "
            "Each hit includes docs_path (/docs/{section}/{slug}) and public_url — "
            "cite those exactly; never invent a shortened /docs/{slug} path. "
            "In customer-facing email drafts, paste public_url as plain text "
            "(never a relative path or markdown link)."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"query": {"type": "string"}, "top_k": {"type": "integer"}},
            "required": ["query"],
        },
        handler=_search_product_help,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="remember_about_me",
        description=(
            "Store one durable fact about the person you are helping, under a short "
            "key like 'role' or 'working-style'. This memory follows them into every "
            "workspace they belong to, so keep it about the person and never store "
            "company or customer data. Empty content forgets the entry."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["key"],
        },
        handler=_remember_about_me,
        mutating=True,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_docs",
        description=(
            "List workspace docs (path, kind, title, project_id, agent_id). "
            "Default is organization knowledge. Pass project_id, agent_id, or "
            "scope=all to include other scopes."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "kind": {"type": "string"},
                "project_id": {"type": "string"},
                "agent_id": {"type": "string"},
                "scope": {
                    "type": "string",
                    "description": "Pass 'all' to list every scope (still filtered by ids).",
                },
            },
        },
        handler=_list_docs,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="read_doc",
        description="Read the full markdown content of a workspace doc by path (e.g. memory.md, skills/triage.md).",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
        handler=_read_doc,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="write_doc",
        description=(
            "Create or update a knowledge page. Knowledge skill: pages are made of "
            "small `##` sections — one topic per section, roughly 150-400 words. "
            "Pass `section` (the `##` heading) to edit exactly one section without "
            "touching the rest of the page; without `section`, content replaces or "
            "appends the whole page. mode=append adds to the end. In a "
            "project-scoped run new docs become project documentation "
            "automatically; pass project_id or agent_id to scope the doc. Prefer "
            "editing existing sections over creating many new files."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "section": {
                    "type": "string",
                    "description": "A `##` heading: write only that section (created when missing).",
                },
                "mode": {"type": "string", "enum": ["append", "replace"]},
                "kind": {"type": "string"},
                "project_id": {
                    "type": "string",
                    "description": "Scope the doc to a project (smart documentation).",
                },
                "agent_id": {
                    "type": "string",
                    "description": "Scope the doc to an agent (personal notes / memory).",
                },
            },
            "required": ["path", "content"],
        },
        handler=_write_doc,
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="send_reply",
        description="Send a reply to the external party on a signal thread (typically after human approval).",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "body_text": {"type": "string"},
                "body_html": {"type": "string"},
                "body": {"type": "string"},
                "messages": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Chat channels: several short messages, sent in order.",
                },
                "subject": {"type": "string"},
                "to": {"type": "string"},
                "send_as": {
                    "type": "string",
                    "enum": ["user", "agent"],
                    "description": "Sender identity for attribution + signature (default: approving user).",
                },
            },
            "required": [],
        },
        handler=_send_reply,
        audience="both",
        consequential=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="suggest_thread_reply",
        description=(
            "Propose a reply to the customer on a conversation without sending it. "
            "The draft appears as a suggested reply the teammate can approve, edit "
            "or decline. Use this while helping on a conversation instead of "
            "pasting a draft into chat."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "body_text": {
                    "type": "string",
                    "description": "The customer-facing reply body, nothing else.",
                },
            },
            "required": ["body_text"],
        },
        handler=_suggest_thread_reply,
        # Proposing to a human is the safe path; it never waits on approval.
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="note_no_reply",
        description=(
            "The inbound message needs no customer reply (newsletter, receipt, "
            "no-reply sender, system alert). Records that judgement on the "
            "conversation for a teammate to confirm. Do not also draft a reply."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "summary": {
                    "type": "string",
                    "description": "One line: what the automated message says.",
                },
            },
            "required": ["summary"],
        },
        handler=_note_no_reply,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="propose_session_checkout",
        description=(
            "Wrap up the inline session you were brought into: propose a checkout "
            "on the conversation with a short summary of what you did and what "
            "you recommend. The teammate ends the session or tells you to keep "
            "going. Call this when the work is done instead of asking in chat. "
            "Options are optional; use kind=apply_actions to label the concrete "
            "actions you already performed. End and continue are always offered."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "summary": {
                    "type": "string",
                    "description": (
                        "One short paragraph: what you did and what is left. "
                        "It becomes the session outcome on the thread."
                    ),
                },
                "options": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "label": {"type": "string"},
                            "kind": {
                                "type": "string",
                                "enum": ["end_only", "continue", "apply_actions"],
                            },
                        },
                        "required": ["label", "kind"],
                    },
                },
            },
            "required": ["summary"],
        },
        handler=_propose_session_checkout,
        # Proposing a checkout is a human gate by construction.
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="take_over_conversation",
        description=(
            "Take the customer conversation over yourself: AI replies resume and "
            "you become the agent that answers the next inbound message. Use when "
            "a teammate asks you to continue with the contact."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "reason": {"type": "string", "description": "Why you are taking over."},
            },
            "required": [],
        },
        handler=_take_over_conversation,
    )
)

async def _set_ai_handling(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Change AI handling at one layer (shared by the two scoped tools).

    Same direction rule as the API: lowering is free, raising to autonomous
    needs an owner/admin session (agents act as members).
    """
    from fastapi import HTTPException

    from app.models.auth import Tenant
    from app.services.ai_handling import normalize_mode, set_ai_handling

    scope = str(tool_input.get("scope") or "conversation")
    target = str(tool_input.get("target_id") or "")
    if scope == "conversation" and not target and ctx.signal_id:
        target = str(ctx.signal_id)
    raw_mode = tool_input.get("mode")
    mode = None if raw_mode in (None, "", "inherit", "follow") else normalize_mode(raw_mode)
    if raw_mode not in (None, "", "inherit", "follow") and mode is None:
        return {"error": "mode must be autonomous, assisted, manual or inherit"}
    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    if tenant is None:
        return {"error": "Workspace not found"}
    if scope == "workspace":
        target = str(ctx.tenant_id)
    if not target:
        return {"error": "target_id required"}
    role = ctx.user_role if ctx.user_id and ctx.user_role else "member"
    try:
        result = await set_ai_handling(
            ctx.session,
            tenant,
            scope,
            target,
            mode,
            actor_type="user" if ctx.user_id and not ctx.agent else "agent",
            actor_id=str(ctx.user_id if ctx.user_id and not ctx.agent else (ctx.agent.id if ctx.agent else "")),
            role=role,
            reason=str(tool_input.get("reason") or "").strip() or None,
        )
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    return {"ok": True, "scope": scope, "target_id": target, "ai_handling": result.to_payload()}


async def _set_thread_ai_handling(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    if str(tool_input.get("scope") or "conversation") not in ("conversation", "contact"):
        return {"error": "Use set_channel_ai_handling for channel or workspace scope"}
    return await _set_ai_handling(ctx, tool_input)


async def _set_channel_ai_handling(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    if str(tool_input.get("scope") or "") not in ("channel", "workspace"):
        return {"error": "Use set_ai_handling for conversation or contact scope"}
    return await _set_ai_handling(ctx, tool_input)


register_tool(
    ToolSpec(
        name="set_ai_handling",
        description=(
            "Change how the AI handles a conversation or a contact: autonomous "
            "(replies on its own within Govern), assisted (drafts for approval) or "
            "manual (a person replies). Use mode inherit to follow the layer above. "
            "Conversation values last until the conversation closes. Raising to "
            "autonomous needs an owner or admin."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["conversation", "contact"]},
                "target_id": {
                    "type": "string",
                    "description": "Conversation (signal) id or contact id. Defaults to the current conversation.",
                },
                "mode": {"type": "string", "enum": ["autonomous", "assisted", "manual", "inherit"]},
                "reason": {"type": "string"},
            },
            "required": ["mode"],
        },
        handler=_set_thread_ai_handling,
    )
)

register_tool(
    ToolSpec(
        name="set_channel_ai_handling",
        description=(
            "Change AI handling for a whole channel (mailbox, website chat, WhatsApp) "
            "or the workspace default: autonomous, assisted or manual (inherit clears "
            "a channel value). Raising to autonomous needs an owner or admin."
        ),
        category="channels",
        input_schema={
            "type": "object",
            "properties": {
                "scope": {"type": "string", "enum": ["channel", "workspace"]},
                "target_id": {"type": "string", "description": "Channel account id (channel scope)."},
                "mode": {"type": "string", "enum": ["autonomous", "assisted", "manual", "inherit"]},
                "reason": {"type": "string"},
            },
            "required": ["scope", "mode"],
        },
        handler=_set_channel_ai_handling,
    )
)

register_tool(
    ToolSpec(
        name="close_thread",
        description="Close a signal thread without replying (mark it resolved, e.g. automated notifications).",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "note": {"type": "string"},
            },
            "required": [],
        },
        handler=_close_thread,
    )
)

register_tool(
    ToolSpec(
        name="mark_handled_externally",
        description=(
            "Log that this conversation was already handled outside Bokito: by phone, "
            "via a personal WhatsApp, from another mailbox, or elsewhere. Writes a "
            "timeline line, clears unread, sets aside open reply proposals and counts "
            "as the team's reply. Set close=true to also close the conversation."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "channel": {"type": "string", "enum": ["phone", "whatsapp", "email", "other"]},
                "note": {"type": "string", "description": "What was agreed, one or two sentences."},
                "close": {"type": "boolean"},
                "language": {"type": "string", "description": "nl or en for the timeline line."},
            },
            "required": ["channel"],
        },
        handler=_mark_handled_externally,
    )
)

register_tool(
    ToolSpec(
        name="record_thread_read",
        description=(
            "Record your read of the newest inbound message: one-sentence summary, "
            "priority (normal|high|urgent), certainty 0-100, urgency/impact 0-100, "
            "coarse category (support|sales|billing|other), optional intent/sentiment, "
            "optional ticket_category (one action-tag hashtag from list_categories), "
            "optional free tags from the catalog, and optional unknown_signal when no "
            "hashtag fits. Call this once early on every inbound turn before drafting. "
            "Low certainty keeps priority at normal and only proposes tickets."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "summary": {"type": "string"},
                "certainty": {"type": "integer"},
                "priority": {"type": "string", "enum": ["normal", "high", "urgent"]},
                "urgency": {"type": "integer"},
                "impact": {"type": "integer"},
                "category": {
                    "type": "string",
                    "enum": ["support", "sales", "billing", "other"],
                },
                "intent": {"type": "string"},
                "sentiment": {"type": "string"},
                "ticket_category": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "unknown_signal": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "sentence": {"type": "string"},
                        "quote": {"type": "string"},
                    },
                },
            },
            "required": ["summary", "certainty"],
        },
        handler=_record_thread_read,
        mutating=True,
        gated=False,
        display_name="Read conversation",
    )
)

register_tool(
    ToolSpec(
        name="set_thread_tags",
        description=(
            "Add free hashtags to a conversation. Names that already exist in the "
            "workspace hashtag catalog are applied; pass create_missing=true to register "
            "new free tags on the fly. Existing hashtags are never removed. "
            "To start a ticket flow, use file_ticket with an action tag instead — do not "
            "treat action tags as ordinary labels here."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "create_missing": {
                    "type": "boolean",
                    "description": "Register tags the catalog does not have yet (free tags only).",
                },
            },
            "required": ["tags"],
        },
        handler=_set_thread_tags,
    )
)


async def _split_conversation(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from fastapi import HTTPException

    from app.models.signal import Signal
    from app.services.conversation_split import (
        resolve_category,
        split_conversation,
        split_or_propose,
    )

    try:
        signal_id = UUID(str(tool_input.get("signal_id") or ctx.signal_id or ""))
        raw_message = str(tool_input.get("from_message_id") or "").strip()
        from_message_id = UUID(raw_message) if raw_message else None
    except ValueError:
        return {"error": "signal_id and from_message_id must be ids"}
    signal = await ctx.session.get(Signal, signal_id)
    if signal is None or signal.tenant_id != ctx.tenant_id:
        return {"error": "Conversation not found"}
    try:
        category = await resolve_category(ctx.session, ctx.tenant_id, tool_input.get("category"))
        if ctx.agent is None:
            # A person ran this (or approved the split card): no AI handling gate.
            child = await split_conversation(
                ctx.session,
                ctx.tenant_id,
                signal_id,
                from_message_id=from_message_id,
                category=category,
                actor_type="user" if ctx.user_id else "system",
                actor_id=str(ctx.user_id or ""),
            )
            return {"status": "split", "signal_id": str(child.id)}
        if category is None:
            return {"error": "category is required: name the new request's category"}
        return await split_or_propose(
            ctx.session,
            ctx.tenant_id,
            signal,
            category=category,
            from_message_id=from_message_id,
            agent_id=ctx.agent.id,
            reason=str(tool_input.get("reason") or ""),
        )
    except HTTPException as exc:
        return {"error": str(exc.detail)}


register_tool(
    ToolSpec(
        name="split_conversation",
        description=(
            "Move a new request into its own conversation. A conversation has one "
            "action tag; when the customer raises something with a different action "
            "tag, split from the message where it starts. The conversation's AI handling "
            "decides the outcome: autonomous splits, assisted asks the team, manual "
            "leaves it to a person."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "from_message_id": {
                    "type": "string",
                    "description": "First message of the new request; defaults to the newest customer message",
                },
                "category": {
                    "type": "string",
                    "description": "Action-tag hashtag (name without #) or id for the new conversation",
                },
                "reason": {"type": "string", "description": "One sentence for the team"},
            },
            "required": ["category"],
        },
        handler=_split_conversation,
        gated=False,
        display_name="Split conversation",
    )
)

register_tool(
    ToolSpec(
        name="handoff_to_human",
        description=(
            "Hand this conversation over to a human team member. Pauses AI replies "
            "on the thread and notifies the team so someone can take over in the "
            "same conversation. Use when the visitor asks for a human/employee, is "
            "frustrated, or when you cannot help."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "reason": {
                    "type": "string",
                    "description": "Short summary of why the visitor needs a human.",
                },
                "to": TO_TARGET_SCHEMA,
            },
            "required": [],
        },
        handler=_handoff_to_human,
        # Escalating TO a human must never itself wait on human approval.
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="request_callback",
        description=(
            "Ask the team to get back to this visitor later. Use when nobody is "
            "available for a live handoff. Chat stays open; do not say "
            "the chat is closed or offline."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "reason": {
                    "type": "string",
                    "description": "Short summary of what the visitor needs a callback for.",
                },
                "to": TO_TARGET_SCHEMA,
            },
            "required": [],
        },
        handler=_request_callback,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="continue_on_whatsapp",
        description=(
            "Offer the website visitor to continue this chat on WhatsApp. Returns a link "
            "with a prefilled message; when they send it, the conversation continues there "
            "with a colleague. Use when nobody is available live and the visitor prefers WhatsApp."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "language": {
                    "type": "string",
                    "description": "The visitor's language code (nl, en) for the prefilled message",
                },
            },
            "required": [],
        },
        handler=_continue_on_whatsapp,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="request_customer_verify",
        description=(
            "Start a short confirmation for this visitor's email so they can see "
            "their own invoices or documents. Ask for the email they use with this "
            "company first. Always tell them to check their inbox. Never say "
            "whether an account exists."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "email": {
                    "type": "string",
                    "description": "The email address the visitor says they use with this company.",
                },
            },
            "required": ["email"],
        },
        handler=_request_customer_verify,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="create_decision_request",
        description=(
            "Ask the human to choose between concrete options via an inline card. "
            "Set input_type to 'text' on an option to let the human answer with "
            "free text instead of clicking a fixed choice. "
            "For action_type use a real platform tool name when approving should "
            "run that tool, or one of: escalate, acknowledge, defer, reject. "
            "Each option needs a distinct id and label. Use send_reply with "
            "payload.body_text when the choice should send a customer message "
            "(e.g. clarification). Use escalate or acknowledge only when a human "
            "takes over with no outbound mail. Outside a conversation (check-ins, "
            "scheduled wakes) pass thread_subject so the card lands on the thread "
            "it concerns; a card without a thread needs at least one option that "
            "runs a platform tool, otherwise report the observation instead. "
            "In a chat, the options appear as buttons under your last message; "
            "pass items (type + id from tool results) so the objects show as "
            "previews inside the message — never paste ids or dump titles in text."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "question": {
                    "type": "string",
                    "description": (
                        "Short question shown above the buttons when your message "
                        "does not already ask it."
                    ),
                },
                "items": PROPOSAL_ITEMS_SCHEMA,
                "selection": {
                    "type": "string",
                    "enum": ["single", "multiple"],
                    "description": "single (default) or multiple picks before Confirm.",
                },
                "signal_id": {"type": "string"},
                "thread_subject": {
                    "type": "string",
                    "description": (
                        "Subject (or a distinctive part of it) of the conversation this "
                        "question is about, when signal_id is unknown."
                    ),
                },
                "to": TO_TARGET_SCHEMA,
                "options": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "label": {"type": "string"},
                            "action_type": {"type": "string"},
                            "payload": {"type": "object"},
                            "input_type": {
                                "type": "string",
                                "enum": ["text"],
                                "description": "Ask for a free-text answer when this option is chosen.",
                            },
                            "input_placeholder": {"type": "string"},
                            "item_ref": {"type": "object"},
                        },
                    },
                },
            },
            "required": ["title", "options"],
        },
        handler=_create_decision_request,
        gated=False,
        audience="both",
    )
)


def _learn_blob(ctx: ToolContext, tool_name: str) -> dict[str, Any] | None:
    if ctx.agent is None or not tool_name:
        return None
    return {
        "tool": tool_name,
        "agent_id": str(ctx.agent.id),
        "reason": "",
        "rule_text": "",
    }


async def _propose_action(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.registry import get_tool_spec

    question = str(tool_input.get("question") or "").strip()
    action = str(tool_input.get("action") or "").strip()
    if not question:
        return {"ok": False, "code": "missing_question", "message": "Pass the question to ask."}
    if action and get_tool_spec(action) is None:
        return {"ok": False, "code": "unknown_action", "message": f"No platform tool named {action}."}
    options: list[dict[str, Any]] = []
    if action:
        approve_opt: dict[str, Any] = {
            "id": "approve",
            "label": str(tool_input.get("approve_label") or "Approve"),
            "action_type": action,
            "payload": tool_input.get("payload") or {},
        }
        learn = _learn_blob(ctx, action)
        if learn:
            approve_opt["learn"] = learn
        options.append(approve_opt)
    for extra in tool_input.get("options") or []:
        if isinstance(extra, dict) and extra.get("id") and extra.get("label"):
            row = dict(extra)
            action_type = str(row.get("action_type") or "").strip()
            if (
                action_type
                and action_type not in ("reject", "defer", "escalate")
                and get_tool_spec(action_type) is not None
                and "learn" not in row
            ):
                learn = _learn_blob(ctx, action_type)
                if learn:
                    row["learn"] = learn
            options.append(row)
    if not options:
        return {
            "ok": False,
            "code": "no_options",
            "message": "Pass action (the tool to run on approve) or at least one option.",
        }
    if not any(o.get("id") == "reject" for o in options):
        options.append({"id": "reject", "label": str(tool_input.get("reject_label") or "Reject"), "action_type": "reject"})
    return await _create_decision_request(
        ctx,
        {
            "title": str(tool_input.get("title") or question)[:200],
            "summary": str(tool_input.get("summary") or ""),
            "question": question,
            "items": tool_input.get("items") or [],
            "options": options,
            "signal_id": tool_input.get("signal_id"),
            "selection": tool_input.get("selection") or "single",
        },
    )


register_tool(
    ToolSpec(
        name="propose_action",
        description=(
            "End your chat message with an inline proposal when you need an answer. "
            "Write a short question (use #tags and [docs](/docs/…) inline; never paste "
            "ids). Pass items for showcase previews, selection single or multiple, and "
            "options (option.id may match an item id so clicking the preview chooses "
            "it). For destructive work (e.g. delete_tag), pass action + payload so "
            "Approve runs that tool; do not invent soft Yes labels without action. "
            "Buttons appear under your message. To only show objects without asking, "
            "use attach_items instead."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "Short question, e.g. 'Restore this item?'"},
                "action": {"type": "string", "description": "Platform tool to run when approved"},
                "payload": {"type": "object", "description": "Input for that tool"},
                "items": PROPOSAL_ITEMS_SCHEMA,
                "selection": {
                    "type": "string",
                    "enum": ["single", "multiple"],
                    "description": "single (default) or multiple — operator can pick several options then Confirm.",
                },
                "approve_label": {"type": "string"},
                "reject_label": {"type": "string"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "signal_id": {"type": "string"},
                "options": {
                    "type": "array",
                    "description": "Choices. Set id to an item id to link a showcase row to that option.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "label": {"type": "string"},
                            "action_type": {"type": "string"},
                            "payload": {"type": "object"},
                            "input_type": {"type": "string", "enum": ["text"]},
                            "input_placeholder": {"type": "string"},
                            "item_ref": {
                                "type": "object",
                                "description": "Optional {type,id} linking this option to a showcase item.",
                            },
                        },
                    },
                },
            },
            "required": ["question"],
        },
        handler=_propose_action,
        gated=False,
        audience="both",
    )
)


async def _attach_items(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.proposal_items import resolve_items, stash_attach_items

    items = await resolve_items(
        ctx.session, ctx.tenant_id, tool_input.get("items") if isinstance(tool_input.get("items"), list) else None
    )
    stash_attach_items(ctx.signal_id, items)
    missing = [i for i in items if i.get("missing")]
    result: dict[str, Any] = {"ok": True, "attached": len(items), "items": items}
    if missing:
        result["missing_items"] = [{"type": i["type"], "id": i["id"]} for i in missing]
    return result


register_tool(
    ToolSpec(
        name="attach_items",
        description=(
            "Show platform objects as showcase cards inside your last chat message "
            "without asking for approval. Pass items [{type, id}]. Types: conversation, "
            "trash_entry, trigger, file, image, user, agent, tag, flow, project, contact, "
            "integration, marketplace, module, help_doc, message. For remote images pass "
            "type image with url (https). For tags in prose use #name instead. "
            "Use propose_action when you need the operator to choose."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {"items": PROPOSAL_ITEMS_SCHEMA},
            "required": ["items"],
        },
        handler=_attach_items,
        gated=False,
        mutating=False,
        audience="both",
    )
)


async def _list_tags(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.models.signal import SignalTag

    rows = (
        await ctx.session.execute(
            select(SignalTag)
            .where(SignalTag.tenant_id == ctx.tenant_id)
            .order_by(SignalTag.name.asc())
        )
    ).scalars().all()
    kind_filter = str(tool_input.get("kind") or "all").strip().lower()
    tags: list[dict[str, Any]] = []
    for row in rows:
        is_action = bool(row.workstream_id)
        kind = "action_tag" if is_action else "tag"
        if kind_filter == "action" and not is_action:
            continue
        if kind_filter in ("free", "tag") and is_action:
            continue
        tags.append(
            {
                "id": str(row.id),
                "name": row.name,
                "kind": kind,
                "description": row.description or "",
                "workstream_id": str(row.workstream_id) if row.workstream_id else None,
                "markup": f"#[[{row.name}]]({'action_tag' if is_action else 'tag'}:{row.id})",
            }
        )
    return {"tags": tags, "count": len(tags)}


async def _delete_tag(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from sqlalchemy import func

    from app.models.signal import SignalTag
    from app.services.signal_tags import delete_tag

    raw_id = tool_input.get("id")
    name = str(tool_input.get("name") or "").strip().lstrip("#").lower()
    row = None
    if raw_id:
        try:
            tag_id = UUID(str(raw_id))
        except (TypeError, ValueError):
            return {"error": "invalid_id", "message": "id must be a tag UUID"}
        row = (
            await ctx.session.execute(
                select(SignalTag).where(SignalTag.id == tag_id, SignalTag.tenant_id == ctx.tenant_id)
            )
        ).scalar_one_or_none()
    elif name:
        row = (
            await ctx.session.execute(
                select(SignalTag)
                .where(SignalTag.tenant_id == ctx.tenant_id, func.lower(SignalTag.name) == name)
                .limit(1)
            )
        ).scalar_one_or_none()
    else:
        return {"error": "missing_tag", "message": "Pass id or name of the tag to delete."}
    if row is None:
        return {"error": "not_found", "message": "Tag not found in this workspace."}
    tag_name = row.name
    tag_id = row.id
    await delete_tag(ctx.session, ctx.tenant_id, tag_id, commit=False)
    return {"ok": True, "deleted": True, "id": str(tag_id), "name": tag_name}


register_tool(
    ToolSpec(
        name="list_tags",
        description=(
            "List workspace tags: free tags and action tags (ticket flows). "
            "Use #name in chat for inline chips, or attach_items with type tag. "
            "Returns id, name, kind (tag|action_tag), description, and markup."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "kind": {
                    "type": "string",
                    "enum": ["all", "free", "action"],
                    "description": "Filter: all (default), free, or action.",
                },
            },
        },
        handler=_list_tags,
        gated=False,
        mutating=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="delete_tag",
        description=(
            "Permanently delete a workspace tag (free tag or action tag) and unlink "
            "it from every conversation. Prefer propose_action with action=delete_tag "
            "and payload {name} or {id} so the operator approves first. Do not invent "
            "soft Yes/No options without this action."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "Tag UUID"},
                "name": {"type": "string", "description": "Tag name without #"},
            },
        },
        handler=_delete_tag,
        gated=True,
        mutating=True,
        audience="both",
        display_name="Delete tag",
    )
)


async def _find_tag_row(ctx: ToolContext, tool_input: dict[str, Any], *keys: str):
    """Tag row by UUID (``tag_id`` / ``id``) or by name; ``(row, error)``."""
    from sqlalchemy import func

    from app.models.signal import SignalTag
    from app.services.signal_tags import normalize_tag

    raw_id = next((tool_input.get(k) for k in keys if tool_input.get(k)), None)
    name = normalize_tag(str(tool_input.get("name") or ""))
    row = None
    if raw_id:
        try:
            tag_id = UUID(str(raw_id))
        except (TypeError, ValueError):
            return None, {"error": "invalid_id", "message": "tag_id must be a tag UUID"}
        row = (
            await ctx.session.execute(
                select(SignalTag).where(SignalTag.id == tag_id, SignalTag.tenant_id == ctx.tenant_id)
            )
        ).scalar_one_or_none()
    elif name:
        row = (
            await ctx.session.execute(
                select(SignalTag)
                .where(SignalTag.tenant_id == ctx.tenant_id, func.lower(SignalTag.name) == name)
                .limit(1)
            )
        ).scalar_one_or_none()
    else:
        return None, {"error": "missing_tag", "message": "Pass tag_id or name."}
    if row is None:
        return None, {"error": "not_found", "message": "Tag not found in this workspace."}
    return row, None


async def _create_tag(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.signal_tags import create_tag, normalize_tag, serialize_tag

    name = normalize_tag(str(tool_input.get("name") or ""))
    if not name:
        return {"error": "missing_name", "message": "Pass the hashtag name without #."}
    row = await create_tag(
        ctx.session,
        ctx.tenant_id,
        name,
        description=str(tool_input.get("description") or ""),
        pinned=bool(tool_input.get("pinned")),
        user_id=ctx.user_id,
        commit=False,
    )
    return {
        "ok": True,
        "tag": serialize_tag(row),
        "markup": f"#[[{row.name}]]({'action_tag' if row.workstream_id else 'tag'}:{row.id})",
    }


async def _update_tag(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.signal_tags import serialize_tag, update_tag

    row, error = await _find_tag_row(ctx, tool_input, "tag_id", "id")
    if error:
        return error
    fields: dict[str, Any] = {}
    if tool_input.get("new_name"):
        fields["name"] = str(tool_input["new_name"])
    if "description" in tool_input and tool_input["description"] is not None:
        fields["description"] = str(tool_input["description"])
    for key in ("pinned", "show_in_nav", "ai_auto_tag"):
        if key in tool_input and tool_input[key] is not None:
            fields[key] = bool(tool_input[key])
    if not fields:
        return {"error": "nothing_to_change", "message": "Pass new_name, description, pinned, show_in_nav or ai_auto_tag."}
    try:
        row = await update_tag(ctx.session, ctx.tenant_id, row.id, commit=False, **fields)
    except ValueError as exc:
        return {"error": "invalid", "message": str(exc)}
    return {"ok": True, "tag": serialize_tag(row)}


register_tool(
    ToolSpec(
        name="create_tag",
        description=(
            "Create a free hashtag (a plain label, no ticket flow) in the workspace "
            "catalog. Use this for ordinary tags; use create_category for an action tag "
            "that starts a ticket flow. Idempotent: an existing name is updated."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Hashtag name without #"},
                "description": {"type": "string", "description": "When to apply it"},
                "pinned": {"type": "boolean", "description": "Show in the hashtag rail"},
            },
            "required": ["name"],
        },
        handler=_create_tag,
        gated=True,
        mutating=True,
        audience="both",
        display_name="Create tag",
    )
)

register_tool(
    ToolSpec(
        name="update_tag",
        description=(
            "Rename or describe a hashtag, or change where it shows (pinned, show_in_nav, "
            "ai_auto_tag). Pass tag_id or name to pick the tag and new_name to rename. "
            "Renaming onto an existing free tag merges the two."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "tag_id": {"type": "string", "description": "Tag UUID"},
                "name": {"type": "string", "description": "Current name without #"},
                "new_name": {"type": "string", "description": "New name without #"},
                "description": {"type": "string"},
                "pinned": {"type": "boolean"},
                "show_in_nav": {"type": "boolean"},
                "ai_auto_tag": {"type": "boolean", "description": "Agents may apply it on their own"},
            },
        },
        handler=_update_tag,
        gated=True,
        mutating=True,
        audience="both",
        display_name="Update tag",
    )
)

register_tool(
    ToolSpec(
        name="suggest_integration",
        description="Proactively suggest setting up an integration or MCP.",
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "provider": {"type": "string"},
                "reason": {"type": "string"},
                "signal_id": {"type": "string"},
            },
            "required": ["provider", "reason"],
        },
        handler=_suggest_integration,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="search_repo",
        description=(
            "Search the indexed source code and docs of connected GitHub repositories. "
            "Optionally scope to one project with project_id. Returns matching file "
            "chunks with paths."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "project_id": {"type": "string"},
            },
            "required": ["query"],
        },
        handler=_search_repo,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="suggest_inbox_rule",
        description=(
            "Suggest an inbox automation rule after learning from a correction or a "
            "recurring pattern (e.g. always auto-close newsletters from a sender). "
            "The operator must confirm before it activates — point them to "
            "confirm_path with an in-app markdown link. "
            "Actions: auto_close, auto_task, mute_ai."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "match_type": {"type": "string", "enum": ["sender", "domain", "list_id"]},
                "match_value": {"type": "string"},
                "action": {"type": "string", "enum": ["auto_close", "auto_task", "mute_ai"]},
                "label": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["match_value", "action", "reason"],
        },
        handler=_suggest_inbox_rule,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="call_mcp_tool",
        description=(
            "Call a tool on a registered external MCP server. Not for business "
            "modules (accounting, banking): those have their own tools such as "
            "accounting_list_companies, which run without approval for reads."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "server_name": {"type": "string"},
                "tool_name": {"type": "string"},
                "arguments": {"type": "object"},
            },
            "required": ["server_name", "tool_name"],
        },
        handler=_call_mcp_tool,
    )
)

register_tool(
    ToolSpec(
        name="create_task",
        description=(
            "On a conversation: plan a human task on that thread (Agenda). "
            "Pass workstream_id or a peer agent_id to start a playbook/delegation job instead."
        ),
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "agent_id": {"type": "string"},
                "project_id": {"type": "string"},
                "workstream_id": {"type": "string"},
                "auto_start": {"type": "boolean"},
            },
            "required": ["title"],
        },
        handler=_create_task,
    )
)

register_tool(
    ToolSpec(
        name="delegate_to_agent",
        description="Delegate work to another agent in this tenant by creating an orchestration task.",
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "agent_slug": {"type": "string"},
                "title": {"type": "string"},
                "instructions": {"type": "string"},
                "message": {"type": "string"},
                "project_id": {"type": "string"},
                "workstream_id": {"type": "string"},
                "auto_start": {"type": "boolean"},
            },
        },
        handler=_delegate_to_agent,
    )
)

register_tool(
    ToolSpec(
        name="assign_conversation",
        description=(
            "Hand this conversation to another agent or a team that fits it better. "
            "The new owner takes over; add a short message saying what they should do. "
            "Only agents and teams with access to this channel can take it."
        ),
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["agent", "team"]},
                "id": {"type": "string", "description": "Agent or team id"},
                "message": {"type": "string", "description": "Handover note for the new owner"},
            },
            "required": ["kind", "id"],
        },
        handler=_assign_conversation,
    )
)

register_tool(
    ToolSpec(
        name="propose_agent_rule",
        description=(
            "Propose a rule for when you act on your own and when you ask first. "
            "Use it when a person tells you how to handle a kind of situation from now on. "
            "Nothing changes until a person confirms the proposal in the conversation."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "The rule in one sentence, as the person said it"},
                "mode": {"type": "string", "enum": ["manual", "assisted", "autonomous"]},
                "kind": {
                    "type": "string",
                    "enum": ["hard", "judgement"],
                    "description": "hard: always for one action or category; judgement: you weigh it per case",
                },
                "tool": {"type": "string", "description": "Action name for a hard rule"},
                "category": {"type": "string", "description": "Tool category for a hard rule"},
            },
            "required": ["text", "mode"],
        },
        handler=_propose_agent_rule,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="create_agent",
        description="Create a new AI agent in the tenant.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "role": {"type": "string"},
                "description": {
                    "type": "string",
                    "description": "Short operator-facing role blurb (not the system prompt)",
                },
                "system_prompt": {"type": "string"},
                "tools": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name"],
        },
        handler=_make_platform_handler("create_agent", "agent", "create", lambda i: f"Create agent {i.get('name')}"),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_agent",
        description="Update an existing agent (name, description, prompt, role).",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {
                    "type": "string",
                    "description": "Short operator-facing role blurb (not the system prompt)",
                },
                "system_prompt": {"type": "string"},
                "role": {"type": "string"},
            },
            "required": ["agent_id"],
        },
        handler=_make_platform_handler("update_agent", "agent", "update", lambda i: f"Update agent {i.get('agent_id')}"),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="create_workstream",
        description="Propose a playbook with an ordered list of canonical steps.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "kind": {
                                "type": "string",
                                "enum": [
                                    "send_message",
                                    "agent_task",
                                    "wait_for_reply",
                                    "ask_decision",
                                    "call_tool",
                                    "schedule",
                                ],
                            },
                            "goal": {"type": "string"},
                            "agent_id": {"type": "string"},
                            "deadline_hours": {"type": "integer"},
                            "on_deadline": {"type": "string"},
                            "config": {"type": "object"},
                        },
                        "required": ["name", "kind"],
                    },
                },
            },
            "required": ["name"],
        },
        handler=_make_platform_handler(
            "create_workstream", "workstream", "create", lambda i: f"Create workstream {i.get('name')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_workstream",
        description="Propose updating a playbook, including replacing its ordered steps.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "workstream_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "enabled": {"type": "boolean"},
                "steps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "name": {"type": "string"},
                            "kind": {
                                "type": "string",
                                "enum": [
                                    "send_message",
                                    "agent_task",
                                    "wait_for_reply",
                                    "ask_decision",
                                    "call_tool",
                                    "schedule",
                                ],
                            },
                            "goal": {"type": "string"},
                            "agent_id": {"type": "string"},
                            "deadline_hours": {"type": "integer"},
                            "on_deadline": {"type": "string"},
                            "config": {"type": "object"},
                        },
                        "required": ["name", "kind"],
                    },
                },
            },
            "required": ["workstream_id"],
        },
        handler=_make_platform_handler(
            "update_workstream", "workstream", "update", lambda i: f"Update workstream {i.get('workstream_id')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="propose_integration",
        description="Propose connecting an integration; always routes to human decision.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "provider": {"type": "string"},
                "reason": {"type": "string"},
                "display_name": {"type": "string"},
            },
            "required": ["provider", "reason"],
        },
        handler=_propose_integration,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="register_mcp_server",
        description="Register an external MCP server for tool access.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {"name": {"type": "string"}, "server_url": {"type": "string"}},
            "required": ["name", "server_url"],
        },
        handler=_make_platform_handler(
            "register_mcp_server", "mcp_server", "create", lambda i: f"Register MCP {i.get('name')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="connect_integration",
        description="Connect an external integration provider.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {"provider": {"type": "string"}, "display_name": {"type": "string"}},
            "required": ["provider"],
        },
        handler=_make_platform_handler(
            "connect_integration", "integration", "create", lambda i: f"Connect {i.get('provider')}"
        ),
        handles_ask=True,
    )
)


async def _retired_os_graph(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    del ctx, tool_input
    return dict(OS_GRAPH_RETIRED)


register_tool(
    ToolSpec(
        name="add_graph_node",
        description=(
            "Retired: the OS graph overlay is gone. Create an Agent, Playbook, or "
            "Connection instead, or edit a project canvas."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "node_type": {"type": "string"},
                "ref_id": {"type": "string"},
                "label": {"type": "string"},
                "x": {"type": "number"},
                "y": {"type": "number"},
            },
            "required": ["node_type", "ref_id"],
        },
        handler=_retired_os_graph,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="connect_graph_nodes",
        description=(
            "Retired: the OS graph overlay is gone. Domain entities stay in Agent, "
            "Playbook, and Connection tables."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "source_node_id": {"type": "string"},
                "target_node_id": {"type": "string"},
                "relation": {"type": "string"},
            },
            "required": ["source_node_id", "target_node_id", "relation"],
        },
        handler=_retired_os_graph,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="create_category",
        description=(
            "Propose a new category: a hashtag with a playbook, so conversations filed "
            "under it become tickets. Pass workstream_id to reuse a playbook, or leave "
            "it out to create one with the default stages. Structural - goes through Govern."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Hashtag name without #"},
                "description": {"type": "string", "description": "When agents should file it"},
                "workstream_id": {"type": "string"},
                "create_mode": {
                    "type": "string",
                    "enum": ["ask_customer", "ask_operator", "auto", "manual_only"],
                },
                "ask_threshold": {"type": "integer"},
                "auto_threshold": {"type": "integer"},
                "send_mode": {"type": "string", "enum": ["draft", "ask", "send"]},
                "requires_verification": {"type": "boolean"},
            },
            "required": ["name"],
        },
        handler=_make_platform_handler(
            "create_category", "category", "create", lambda i: f"Create category #{i.get('name')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_category",
        description=(
            "Propose an update to a category: description, playbook (workstream_id; "
            "null makes it a free tag), intake mode, thresholds, send mode or rail visibility."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "tag_id": {"type": "string"},
                "description": {"type": "string"},
                "workstream_id": {"type": ["string", "null"]},
                "create_mode": {"type": "string"},
                "ask_threshold": {"type": "integer"},
                "auto_threshold": {"type": "integer"},
                "send_mode": {"type": "string"},
                "autonomy_level": {"type": "string"},
                "requires_verification": {"type": "boolean"},
                "show_in_nav": {"type": "boolean"},
            },
            "required": ["tag_id"],
        },
        handler=_make_platform_handler(
            "update_category", "category", "update", lambda i: f"Update category {i.get('tag_id')}"
        ),
        handles_ask=True,
    )
)


# ── tenant introspection (read-only) ─────────────────────────────


async def _get_tenant_overview(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.cockpit import cockpit_summary
    from app.services.tenant_introspection import collect_tenant_snapshot

    snapshot = await collect_tenant_snapshot(ctx.session, ctx.tenant_id)
    try:
        usage = await cockpit_summary(ctx.session, ctx.tenant_id)
    except Exception:
        usage = {}
    return {
        **snapshot,
        "usage": {
            "volume_week": usage.get("volume_week"),
            "open_decisions": usage.get("open_decisions"),
            "autonomy_rate_pct": usage.get("autonomy_rate_pct"),
            "tokens_month": usage.get("tokens_month"),
            "cost_cents_month": usage.get("cost_cents_month"),
        },
    }


async def _list_recent_activity(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tenant_introspection import list_recent_activity

    items = await list_recent_activity(
        ctx.session, ctx.tenant_id, limit=int(tool_input.get("limit") or 20)
    )
    return {"items": items}


async def _list_tasks(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tenant_introspection import list_tasks

    items = await list_tasks(
        ctx.session,
        ctx.tenant_id,
        status=tool_input.get("status"),
        project_id=tool_input.get("project_id"),
        limit=int(tool_input.get("limit") or 30),
    )
    return {"tasks": items}


async def _get_usage_summary(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.cockpit import usage_breakdown

    days = int(tool_input.get("days") or 30)
    return await usage_breakdown(ctx.session, ctx.tenant_id, days=days)


async def _get_platform_watch(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.platform_watch import watch_status

    return await watch_status(ctx.session, ctx.tenant_id)


async def _set_platform_watch(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.platform_watch import set_platform_watch

    enabled = tool_input.get("enabled")
    if not isinstance(enabled, bool):
        return {"error": "enabled must be true or false"}
    return await set_platform_watch(ctx.session, ctx.tenant_id, enabled)


async def _list_threads(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tenant_introspection import list_threads_summary

    older_raw = tool_input.get("older_than_days")
    older_than_days = int(older_raw) if older_raw is not None else None
    scheduled_from = _parse_when(tool_input.get("scheduled_from"))
    scheduled_to = _parse_when(tool_input.get("scheduled_to"))
    return await list_threads_summary(
        ctx.session,
        ctx.tenant_id,
        status=tool_input.get("status", "open"),
        channel=tool_input.get("channel"),
        older_than_days=older_than_days,
        limit=int(tool_input.get("limit") or 25),
        scheduled_from=scheduled_from,
        scheduled_to=scheduled_to,
    )


async def _close_threads(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Close many open/pending threads by id list or by inactivity age."""
    from app.services.tenant_introspection import list_threads_summary

    note = str(tool_input.get("note") or "").strip()
    dry_run = bool(tool_input.get("dry_run"))
    limit = max(1, min(int(tool_input.get("limit") or 100), 200))
    raw_ids = tool_input.get("signal_ids") or []
    if isinstance(raw_ids, str):
        raw_ids = [raw_ids]
    if not isinstance(raw_ids, list):
        return {"error": "signal_ids must be a list of ids"}

    older_raw = tool_input.get("older_than_days")
    signal_ids: list[str] = []
    matched = 0
    if raw_ids:
        signal_ids = [str(x).strip() for x in raw_ids if str(x).strip()]
        matched = len(signal_ids)
        signal_ids = signal_ids[:limit]
    elif older_raw is not None:
        summary = await list_threads_summary(
            ctx.session,
            ctx.tenant_id,
            status=tool_input.get("status", "open"),
            channel=tool_input.get("channel"),
            older_than_days=int(older_raw),
            limit=limit,
        )
        signal_ids = [row["id"] for row in summary.get("threads") or []]
        matched = int(summary.get("matched") or len(signal_ids))
    else:
        return {"error": "Provide older_than_days or signal_ids"}

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "matched": matched,
            "would_close": len(signal_ids),
            "signal_ids": signal_ids,
            "truncated": matched > len(signal_ids),
        }

    closed: list[str] = []
    errors: list[dict[str, str]] = []
    for sid in signal_ids:
        result = await _close_thread(ctx, {"signal_id": sid, "note": note})
        if result.get("ok"):
            closed.append(sid)
        else:
            errors.append({"signal_id": sid, "error": str(result.get("error") or "failed")})

    return {
        "ok": True,
        "closed": len(closed),
        "matched": matched,
        "signal_ids": closed,
        "errors": errors,
        "truncated": matched > len(signal_ids),
        "note": (
            "Call again with the same filters if truncated is true — "
            "only one page is closed per call."
        ),
    }


register_tool(
    ToolSpec(
        name="get_tenant_overview",
        description=(
            "Live tenant snapshot: agents, projects, enabled triggers (schedule + last run), "
            "open decisions/tasks/internal threads, integrations/MCP servers, and usage totals. "
            "Call this before claiming you lack information about the tenant or a project."
        ),
        category="govern",
        input_schema={"type": "object", "properties": {}},
        handler=_get_tenant_overview,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_recent_activity",
        description=(
            "Recent agent runs, trigger firings, and operational outcomes. "
            "Use to answer what happened lately in the tenant or a project."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {"limit": {"type": "integer"}},
        },
        handler=_list_recent_activity,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_tasks",
        description="List orchestration AgentTasks (queued/running/completed). Optional status and project_id filters.",
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "status": {"type": "string"},
                "project_id": {"type": "string"},
                "limit": {"type": "integer"},
            },
        },
        handler=_list_tasks,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="get_usage_summary",
        description="Token and cost breakdown by model and agent for the recent period (default 30 days).",
        category="govern",
        input_schema={
            "type": "object",
            "properties": {"days": {"type": "integer"}},
        },
        handler=_get_usage_summary,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_threads",
        description=(
            "Summarize Signal threads (subject, channel, status, last activity, path). "
            "Defaults to open/pending threads. Does not include Bin items — use list_trash "
            "for deleted conversations (type conversation, alias signal). "
            "In prose chip a thread with [Subject](/communication/inbox/open/t/{id}) from "
            "path — never invent /threads/... paths. "
            "Optional channel filter (internal, assistant, widget, email). "
            "Use older_than_days to find stale threads; response includes matched/returned "
            "so you know when to page with a higher limit (max 200). "
            "scheduled_from / scheduled_to (ISO) list threads with a date in that window "
            "(the agenda: appointments, planned tasks, recurring tasks), earliest first."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "status": {"type": "string"},
                "channel": {"type": "string"},
                "older_than_days": {"type": "integer"},
                "limit": {"type": "integer"},
                "scheduled_from": {"type": "string"},
                "scheduled_to": {"type": "string"},
            },
        },
        handler=_list_threads,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="close_threads",
        description=(
            "Close many open/pending threads at once for cleanup or support. "
            "Pass older_than_days (inactive longer than N days) and/or signal_ids. "
            "Set dry_run=true to preview ids without closing. One page per call "
            "(limit max 200); if truncated is true, call again with the same filters."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "older_than_days": {"type": "integer"},
                "signal_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "status": {"type": "string"},
                "channel": {"type": "string"},
                "limit": {"type": "integer"},
                "note": {"type": "string"},
                "dry_run": {"type": "boolean"},
            },
        },
        handler=_close_threads,
        mutating=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="get_platform_watch",
        description=(
            "Show whether the workspace check-in is on. The check-in is the "
            "assistant waking on a timer, reading heartbeat.md, and writing "
            "only when something needs attention, in the check-in's own "
            "conversation in Communication."
        ),
        category="triggers",
        input_schema={"type": "object", "properties": {}},
        handler=_get_platform_watch,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="set_platform_watch",
        description=(
            "Turn the workspace check-in on or off. This only toggles the "
            "seeded check-in (not other Agenda items). Use enabled true so you "
            "watch the workspace yourself; findings land in its own conversation."
        ),
        category="triggers",
        input_schema={
            "type": "object",
            "properties": {"enabled": {"type": "boolean"}},
            "required": ["enabled"],
        },
        handler=_set_platform_watch,
        mutating=True,
        gated=True,
    )
)


def _parse_when(raw: Any):
    from datetime import datetime as _dt

    text = str(raw or "").strip()
    if not text:
        return None
    try:
        parsed = _dt.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    # Store naive UTC like the rest of the schema.
    if parsed.tzinfo is not None:
        from datetime import timezone as _tz

        parsed = parsed.astimezone(_tz.utc).replace(tzinfo=None)
    return parsed


async def _schedule_task(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Plan a Task for later: for yourself, a peer agent, or a human."""
    from uuid import UUID as _UUID

    from app.services.agent.style import strip_emoji
    from app.services.orchestration.dispatcher import create_agent_task

    assignee = str(tool_input.get("assignee") or "agent").strip().lower()
    if assignee not in ("agent", "human"):
        return {"error": "assignee must be 'agent' or 'human'"}
    scheduled_for = _parse_when(tool_input.get("scheduled_for"))
    if tool_input.get("scheduled_for") and scheduled_for is None:
        return {"error": "scheduled_for must be an ISO datetime, e.g. 2026-09-04T09:00"}
    title = strip_emoji(str(tool_input.get("title", ""))) or "Planned task"

    agent_id = (
        _UUID(str(tool_input["agent_id"]))
        if tool_input.get("agent_id")
        else (ctx.agent.id if ctx.agent else None)
    )
    # Explicit user_id wins; for human work default to the operator who invoked
    # the tool so promotion can notify someone.
    if tool_input.get("user_id"):
        user_id = _UUID(str(tool_input["user_id"]))
    elif assignee == "human":
        user_id = ctx.user_id
    else:
        user_id = None
    task = await create_agent_task(
        ctx.session,
        ctx.tenant_id,
        title=title,
        description=str(tool_input.get("description") or ""),
        agent_id=agent_id,
        project_id=_UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else None,
        signal_id=ctx.signal_id,
        created_by=ctx.user_id,
        origin="delegation" if ctx.agent else "manual",
        kind=str(tool_input.get("kind") or "task"),
        priority=str(tool_input.get("priority") or "normal"),
        assignee_kind=assignee,
        assignee_user_id=user_id,
        scheduled_for=scheduled_for,
        auto_start=scheduled_for is None and assignee == "agent",
    )
    return {
        "task_id": str(task.id),
        "status": task.status,
        "assignee_kind": task.assignee_kind,
        "scheduled_for": task.scheduled_for.isoformat() if task.scheduled_for else None,
    }


async def _set_thread_schedule(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Put a date or a repeat on a conversation; a new one with ``new_thread``."""
    from uuid import UUID as _UUID

    from fastapi import HTTPException

    from app.models.signal import Signal
    from app.services.agent.style import strip_emoji
    from app.services.thread_schedule import apply_thread_schedule, resolve_recipient, schedule_payload

    at = _parse_when(tool_input.get("at"))
    if tool_input.get("at") and at is None:
        return {"error": "at must be an ISO datetime, e.g. 2026-09-04T09:00:00+02:00"}
    ends_at = _parse_when(tool_input.get("ends_at"))
    cron = str(tool_input.get("cron") or "").strip() or None
    try:
        every_minutes = int(tool_input.get("every_minutes") or 0) or None
    except (TypeError, ValueError):
        every_minutes = None
    instructions = tool_input.get("instructions")
    instructions = strip_emoji(str(instructions)).strip() if instructions is not None else None
    title = strip_emoji(str(tool_input.get("title") or "")).strip()
    try:
        agent_id = _UUID(str(tool_input["agent_id"])) if tool_input.get("agent_id") else None
    except ValueError:
        return {"error": "agent_id is not a valid id"}
    if agent_id is None and instructions and ctx.agent is not None:
        agent_id = ctx.agent.id
    wants_rule = bool(cron or every_minutes or (agent_id and instructions))

    signal: Signal | None = None
    raw_id = tool_input.get("signal_id")
    if raw_id:
        try:
            signal = await ctx.session.get(Signal, _UUID(str(raw_id)))
        except ValueError:
            signal = None
        if signal is None or signal.tenant_id != ctx.tenant_id or signal.deleted_at is not None:
            return {"error": "Conversation not found"}
    elif not tool_input.get("new_thread") and ctx.signal_id:
        signal = await ctx.session.get(Signal, ctx.signal_id)
    # A personal chat stays a chat: a recurring task gets its own conversation.
    if signal is not None and signal.channel == "assistant" and wants_rule and not raw_id:
        signal = None
    if signal is None and not title:
        title = (instructions or "")[:60].strip()
    if not wants_rule and at is None and signal is not None and ends_at is None:
        return {"error": "Pass at (a moment), cron or every_minutes."}

    try:
        if "recipient" in tool_input:
            recipient = await resolve_recipient(ctx.session, ctx.tenant_id, tool_input.get("recipient"))
            if recipient is None and ctx.user_id:
                recipient = ("user", ctx.user_id)
        elif signal is None and ctx.user_id:
            recipient = ("user", ctx.user_id)
        else:
            recipient = ...
        signal, rule = await apply_thread_schedule(
            ctx.session,
            ctx.tenant_id,
            signal=signal,
            title=title,
            at=at,
            ends_at=ends_at,
            cron=cron,
            every_minutes=every_minutes,
            agent_id=agent_id,
            instructions=instructions,
            recipient=recipient,
            details={"note": str(tool_input["note"])} if tool_input.get("note") else None,
            created_by_user_id=ctx.user_id,
            project_id=_UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else None,
            actor_type="agent" if ctx.agent else "user",
            actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
            enabled=tool_input.get("enabled") is not False,
        )
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    await ctx.session.commit()
    from app.gateway.publish import publish_thread_update

    await publish_thread_update(signal)
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "subject": signal.subject,
        "next_at": signal.next_at.isoformat() if signal.next_at else None,
        "schedule": schedule_payload(rule),
    }


async def _clear_thread_schedule(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.signal import Signal
    from app.services.thread_schedule import clear_thread_schedule

    raw = tool_input.get("signal_id") or ctx.signal_id
    if not raw:
        return {"error": "signal_id is required"}
    try:
        signal = await ctx.session.get(Signal, _UUID(str(raw)))
    except ValueError:
        signal = None
    if signal is None or signal.tenant_id != ctx.tenant_id:
        return {"error": "Conversation not found"}
    await clear_thread_schedule(
        ctx.session,
        signal,
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    await ctx.session.commit()
    from app.gateway.publish import publish_thread_update

    await publish_thread_update(signal)
    return {"ok": True, "signal_id": str(signal.id)}


async def _schedule_wake(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Alias of set_thread_schedule with an agent wake (yourself by default)."""
    if not str(tool_input.get("instructions") or "").strip():
        return {"error": "instructions is required: what should the agent do on wake?"}
    mapped = dict(tool_input)
    if tool_input.get("name") and not tool_input.get("title"):
        mapped["title"] = tool_input["name"]
    if not mapped.get("agent_id") and ctx.agent is None:
        return {"error": "No agent to wake: pass agent_id or call as an agent."}
    return await _set_thread_schedule(ctx, mapped)


register_tool(
    ToolSpec(
        name="schedule_task",
        description=(
            "Plan a Task for later or assign work to a human. Set scheduled_for "
            "(ISO datetime) to make it dormant until then; assignee 'human' puts "
            "it in front of the team (optionally a specific user_id) instead of "
            "an agent. Use this whenever something must be done later — by you, "
            "a peer agent, or a person."
        ),
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "assignee": {"type": "string", "enum": ["agent", "human"]},
                "agent_id": {"type": "string", "description": "Agent to run it (default: yourself)."},
                "user_id": {"type": "string", "description": "Specific human owner; empty = any member."},
                "scheduled_for": {"type": "string", "description": "ISO datetime when the task becomes active."},
                "project_id": {"type": "string"},
                "kind": {"type": "string", "enum": ["task", "job", "feature", "bug", "idea", "risk"]},
                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
            },
            "required": ["title"],
        },
        handler=_schedule_task,
        mutating=True,
        gated=True,
    )
)

_THREAD_SCHEDULE_PROPS: dict[str, Any] = {
    "signal_id": {
        "type": "string",
        "description": "Conversation to plan (default: this conversation).",
    },
    "new_thread": {
        "type": "boolean",
        "description": "Start a new agenda conversation instead (needs title).",
    },
    "title": {"type": "string", "description": "Subject of the (new) conversation."},
    "at": {"type": "string", "description": "ISO datetime: the moment, or the first run of a repeat."},
    "ends_at": {"type": "string", "description": "ISO datetime the appointment ends."},
    "cron": {"type": "string", "description": "5-field cron (UTC) for a repeat, e.g. 0 7 * * 1-5."},
    "every_minutes": {"type": "integer", "description": "Repeat every N minutes (min 5)."},
    "agent_id": {
        "type": "string",
        "description": "Agent that works on each moment (default: yourself when instructions are set).",
    },
    "instructions": {"type": "string", "description": "What the agent does on each moment."},
    "recipient": {
        "type": "string",
        "description": "Who it is for: a member's name or email, or a team name (default: the person asking).",
    },
    "note": {"type": "string", "description": "Short note shown with the date."},
    "project_id": {"type": "string"},
    "enabled": {"type": "boolean", "description": "false pauses the repeat."},
}

register_tool(
    ToolSpec(
        name="set_thread_schedule",
        description=(
            "Plan a conversation. A conversation with a date is an agenda item; with "
            "a repeat (cron or every_minutes) it is a recurring task. Without an agent "
            "the conversation comes back (open, unread, owner notified) at the moment. "
            "With agent_id + instructions the agent works in the conversation on each "
            "moment and writes to the recipient only when there is something new. "
            "Use for reminders ('look at this Friday'), appointments, and recurring "
            "tasks such as a weekly summary for a person or team. Edits the existing "
            "schedule when called again on the same conversation."
        ),
        category="triggers",
        input_schema={"type": "object", "properties": _THREAD_SCHEDULE_PROPS},
        handler=_set_thread_schedule,
        mutating=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="clear_thread_schedule",
        description="Remove the date and any repeat from a conversation (default: this one).",
        category="triggers",
        input_schema={"type": "object", "properties": {"signal_id": {"type": "string"}}},
        handler=_clear_thread_schedule,
        mutating=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="schedule_wake",
        description=(
            "Alias of set_thread_schedule for an agent wake (yourself by default): "
            "once (at), cron, or every_minutes. The wake runs in a conversation of "
            "its own, or in this one when it is not a personal chat."
        ),
        category="triggers",
        input_schema={
            "type": "object",
            "properties": {**_THREAD_SCHEDULE_PROPS, "name": {"type": "string"}},
            "required": ["instructions"],
        },
        handler=_schedule_wake,
        mutating=True,
        gated=True,
    )
)


async def _create_project(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    name = str(tool_input.get("name") or "").strip()
    if not name:
        return {"error": "name is required"}
    slug = str(tool_input.get("slug") or name).strip().lower().replace(" ", "-")
    return await _platform_change(
        ctx,
        resource_type="project",
        change_kind="create",
        summary=f"Create project {name}",
        after={
            "name": name,
            "slug": slug,
            "description": str(tool_input.get("description") or ""),
            "autonomous_scope": str(tool_input.get("autonomous_scope") or "project"),
        },
        tool_name="create_project",
    )


async def _upsert_trigger(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Same write path as schedule_wake: a scheduled conversation."""
    return await _schedule_wake(ctx, tool_input)


async def _set_posture(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Propose changing workspace autonomy posture. Always asks (Govern)."""
    from app.tools.policy import AUTONOMY_POSTURES, resolve_posture

    posture = str(tool_input.get("posture") or "").strip()
    if posture not in AUTONOMY_POSTURES:
        return {"error": f"Invalid posture: {posture}. Use manual, assisted, or autonomous."}
    tenant = await _get_tenant(ctx)
    previous = resolve_posture(tenant)
    # Force ask: propose without yolo so a person always confirms posture changes.
    return await _platform_change(
        ctx,
        resource_type="autonomy_posture",
        change_kind="update",
        summary=f"Change autonomy posture from {previous} to {posture}",
        after={"posture": posture},
        before={"posture": previous},
        tool_name="set_posture",
    )


register_tool(
    ToolSpec(
        name="create_project",
        description=(
            "Propose creating a Project (container for signals and conversations). "
            "Goes through Govern like other structural changes."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "slug": {"type": "string"},
                "description": {"type": "string"},
                "autonomous_scope": {"type": "string"},
            },
            "required": ["name"],
        },
        handler=_create_project,
        mutating=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="upsert_trigger",
        description=(
            "Alias of set_thread_schedule for an agent wake (one-off or recurring); "
            "same scheduled conversation, same Agenda."
        ),
        category="triggers",
        input_schema={
            "type": "object",
            "properties": {**_THREAD_SCHEDULE_PROPS, "name": {"type": "string"}},
            "required": ["instructions"],
        },
        handler=_upsert_trigger,
        mutating=True,
        gated=True,
    )
)

register_tool(
    ToolSpec(
        name="set_posture",
        description=(
            "Propose changing the workspace autonomy posture (manual | assisted | autonomous). "
            "Always requires human confirmation in Govern — never applied silently."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "posture": {
                    "type": "string",
                    "enum": ["manual", "assisted", "autonomous"],
                },
            },
            "required": ["posture"],
        },
        handler=_set_posture,
        mutating=True,
        gated=True,
    )
)


async def _dispatch_work(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Hand a signal brief to a connected workbench (Cursor / Claude / Devin)."""
    from uuid import UUID as _UUID

    from sqlalchemy import select

    from app.models.integration import IntegrationConnection
    from app.services.workbench import Budget, JobSpec
    from app.services.workbench.gateway import JobLinks, dispatch

    provider = str(tool_input.get("provider") or "cursor")
    if provider == "anthropic":
        provider = "claude_managed"
    repo_url = str(tool_input.get("repo_url") or "").strip()
    if not repo_url:
        return {"error": "repo_url is required"}
    brief = str(tool_input.get("brief") or tool_input.get("goal") or "").strip()
    if not brief:
        return {"error": "brief is required"}

    connection_id = tool_input.get("workbench_connection_id")
    if connection_id:
        conn_id = _UUID(str(connection_id))
    else:
        conn = (
            await ctx.session.execute(
                select(IntegrationConnection).where(
                    IntegrationConnection.tenant_id == ctx.tenant_id,
                    IntegrationConnection.kind == "workbench",
                    IntegrationConnection.provider == provider,
                    IntegrationConnection.status == "active",
                )
            )
        ).scalar_one_or_none()
        if conn is None:
            return {
                "error": (
                    f"No active workbench connection for {provider}. "
                    "Connect it under Settings → Developers → Hand work to a coding tool."
                )
            }
        conn_id = conn.id

    max_minutes = int(tool_input.get("max_minutes") or 60)
    max_cost = tool_input.get("max_cost_cents")
    spec = JobSpec(
        repo_url=repo_url,
        ref=str(tool_input.get("ref") or "main"),
        brief=brief,
        context_packet={
            "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
            "project_id": tool_input.get("project_id"),
            "acceptance": tool_input.get("acceptance"),
        },
        options={
            "create_pull_request": bool(tool_input.get("create_pull_request", True)),
            "max_acu_limit": tool_input.get("max_acu_limit"),
        },
        model=str(tool_input["model"]) if tool_input.get("model") else None,
        mode=str(tool_input.get("mode") or "agent"),
        create_pr=bool(tool_input.get("create_pull_request", True)),
        budget=Budget(
            max_minutes=max_minutes,
            max_cost_cents=int(max_cost) if max_cost is not None else None,
        ),
    )
    links = JobLinks(
        signal_id=ctx.signal_id,
        project_id=_UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else None,
        agent_id=ctx.agent.id if ctx.agent else None,
        decision_id=None,
    )
    try:
        job = await dispatch(
            ctx.session,
            tenant_id=ctx.tenant_id,
            spec=spec,
            connection_id=conn_id,
            links=links,
            approved_by=ctx.user_id,
        )
    except Exception as exc:  # noqa: BLE001 — surface provider errors to the agent
        return {"error": str(exc)}
    return {
        "job_id": str(job.id),
        "provider": job.provider,
        "state": job.state,
        "external_id": job.external_id,
        "external_ids": json.loads(job.external_ids_json or "{}"),
    }


register_tool(
    ToolSpec(
        name="dispatch_work",
        description=(
            "Hand coding work to a connected workbench (Cursor Cloud Agents, Claude Managed "
            "Agents, or Devin). Always asks first. Results come back as thread messages."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "provider": {
                    "type": "string",
                    "enum": ["cursor", "claude_managed", "devin", "anthropic"],
                },
                "repo_url": {"type": "string"},
                "ref": {"type": "string"},
                "brief": {"type": "string"},
                "goal": {"type": "string"},
                "project_id": {"type": "string"},
                "workbench_connection_id": {"type": "string"},
                "acceptance": {"type": "string"},
                "create_pull_request": {"type": "boolean"},
                "model": {"type": "string"},
                "mode": {"type": "string", "enum": ["agent", "plan"]},
                "max_minutes": {"type": "integer"},
                "max_cost_cents": {"type": "integer"},
                "max_acu_limit": {"type": "integer"},
            },
            "required": ["repo_url", "brief"],
        },
        handler=_dispatch_work,
        mutating=True,
        gated=True,
        consequential=True,
    )
)


async def _follow_up_work(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench.gateway import follow_up

    job_id = tool_input.get("job_id")
    text = str(tool_input.get("text") or "").strip()
    if not job_id or not text:
        return {"error": "job_id and text are required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    try:
        await follow_up(ctx.session, job, text, actor=ctx.user_id)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
    return {"job_id": str(job.id), "state": job.state}


register_tool(
    ToolSpec(
        name="follow_up_work",
        description="Send a follow-up message to a running workbench job.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "text": {"type": "string"},
            },
            "required": ["job_id", "text"],
        },
        handler=_follow_up_work,
        mutating=True,
        gated=True,
    )
)


async def _cancel_work(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench.gateway import cancel

    job_id = tool_input.get("job_id")
    if not job_id:
        return {"error": "job_id is required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    try:
        await cancel(ctx.session, job, actor=ctx.user_id)
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
    return {"job_id": str(job.id), "state": job.state}


register_tool(
    ToolSpec(
        name="cancel_work",
        description="Stop a running workbench job.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
        handler=_cancel_work,
        mutating=True,
        gated=True,
    )
)


async def _report_progress(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench import NormalizedEvent
    from app.services.workbench.gateway import ingest

    job_id = tool_input.get("job_id") or tool_input.get("job_ref")
    summary = str(tool_input.get("summary") or tool_input.get("text") or "").strip()
    if not job_id or not summary:
        return {"error": "job_id and summary are required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    await ingest(
        ctx.session,
        job,
        [
            NormalizedEvent(
                kind="progress",
                summary=summary,
                external_event_id=f"mcp-progress:{job.id}:{summary[:80]}",
            )
        ],
    )
    await ctx.session.commit()
    return {"ok": True, "state": job.state}


register_tool(
    ToolSpec(
        name="report_progress",
        description="Update the progress line for the workbench job that holds this MCP token.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "text": {"type": "string"},
                "job_id": {"type": "string"},
                "job_ref": {"type": "string"},
            },
            "required": ["summary"],
        },
        handler=_report_progress,
        mutating=True,
    )
)


async def _ask_question(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench import NormalizedEvent
    from app.services.workbench.gateway import ingest

    job_id = tool_input.get("job_id") or tool_input.get("job_ref")
    question = str(tool_input.get("question") or tool_input.get("text") or "").strip()
    if not job_id or not question:
        return {"error": "job_id and question are required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    await ingest(
        ctx.session,
        job,
        [
            NormalizedEvent(
                kind="needs_input",
                summary=question,
                external_event_id=f"mcp-ask:{job.id}:{question[:80]}",
            )
        ],
    )
    await ctx.session.commit()
    return {"ok": True, "state": "needs_input"}


register_tool(
    ToolSpec(
        name="ask_question",
        description="Ask the operator a question about the current workbench job (raises a Decision).",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                "text": {"type": "string"},
                "job_id": {"type": "string"},
                "job_ref": {"type": "string"},
            },
            "required": ["question"],
        },
        handler=_ask_question,
        mutating=True,
    )
)


async def _attach_artifact(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench import NormalizedEvent
    from app.services.workbench.gateway import ingest

    job_id = tool_input.get("job_id") or tool_input.get("job_ref")
    if not job_id:
        return {"error": "job_id is required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    artifact = {
        "type": str(tool_input.get("type") or "url"),
        "url": str(tool_input.get("url") or ""),
        "ref": str(tool_input.get("ref") or ""),
        "title": str(tool_input.get("title") or tool_input.get("summary") or "Artifact"),
        "state": tool_input.get("state"),
        "external_id": str(tool_input.get("external_id") or tool_input.get("url") or ""),
    }
    await ingest(
        ctx.session,
        job,
        [
            NormalizedEvent(
                kind="artifact",
                summary=artifact["title"],
                external_event_id=f"mcp-art:{job.id}:{artifact['external_id'] or artifact['title']}",
                payload={"artifact": artifact},
            )
        ],
    )
    await ctx.session.commit()
    return {"ok": True, "artifact": artifact}


register_tool(
    ToolSpec(
        name="attach_artifact",
        description="Attach a PR, branch, or URL artifact to the current workbench job.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["pr", "diff", "branch", "log", "summary", "url"]},
                "url": {"type": "string"},
                "ref": {"type": "string"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "state": {"type": "string"},
                "external_id": {"type": "string"},
                "job_id": {"type": "string"},
                "job_ref": {"type": "string"},
            },
            "required": ["type"],
        },
        handler=_attach_artifact,
        mutating=True,
    )
)


# ── workforce introspection (agents / playbooks / triggers) ──────


_AVATAR_KEYS = ("avatar_kind", "avatar_icon", "avatar_color", "avatar_image_url")


def _serialize_agent_row(row: Any, *, detail: bool = False) -> dict[str, Any]:
    from app.services.workforce_runtime import serialize_agent

    data = {k: v for k, v in serialize_agent(row, view="passport").items() if k not in _AVATAR_KEYS}
    agent_id = str(row.id)
    name = str(row.name or "Agent")
    # Inline chips: @[Name](agent:{id}) or [Name](/agents/{id}).
    data["path"] = f"/agents/{agent_id}"
    data["mention"] = f"@[{name}](agent:{agent_id})"
    if not detail:
        data.pop("tools", None)
        data.pop("permission_scopes", None)
        return data
    data.update(
        {
            # Stored as system_prompt; operators and the API call it purpose.
            "purpose": row.system_prompt or "",
            "chat_access": row.chat_access,
            "max_loops": row.max_loops,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
    )
    return data


async def _showcase_agents(ctx: ToolContext, agent_ids: list[str]) -> list[dict[str, Any]]:
    """Resolve and stash agent cards for the final reply bubble."""
    from app.services.proposal_items import resolve_items, stash_attach_items

    if not agent_ids:
        return []
    showcase = await resolve_items(
        ctx.session,
        ctx.tenant_id,
        [{"type": "agent", "id": aid} for aid in agent_ids],
    )
    if showcase:
        stash_attach_items(ctx.signal_id, showcase)
    return showcase


async def _list_agents(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.models.agent import Agent

    stmt = select(Agent).where(Agent.tenant_id == ctx.tenant_id)
    if tool_input.get("include_inactive") is not True:
        stmt = stmt.where(Agent.is_active.is_(True))
    rows = (
        await ctx.session.execute(stmt.order_by(Agent.name).limit(100))
    ).scalars().all()
    agents = [_serialize_agent_row(row) for row in rows]
    showcase = await _showcase_agents(ctx, [a["id"] for a in agents if a.get("id")])
    return {"agents": agents, "count": len(agents), "items": showcase}


async def _get_agent(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.models.agent import Agent

    raw = str(tool_input.get("agent_id") or tool_input.get("agent_slug") or "").strip()
    if not raw:
        return {"error": "agent_id or agent_slug is required"}
    try:
        stmt = select(Agent).where(
            Agent.id == UUID(raw), Agent.tenant_id == ctx.tenant_id
        )
    except ValueError:
        stmt = select(Agent).where(Agent.slug == raw, Agent.tenant_id == ctx.tenant_id)
    row = (await ctx.session.execute(stmt)).scalar_one_or_none()
    if row is None:
        return {"error": "Agent not found"}
    payload = _serialize_agent_row(row, detail=True)
    showcase = await _showcase_agents(ctx, [payload["id"]])
    return {**payload, "items": showcase}


async def _list_playbooks(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workstreams import list_workstreams

    project_id = None
    raw_project = str(tool_input.get("project_id") or "").strip()
    if raw_project:
        try:
            project_id = UUID(raw_project)
        except ValueError:
            return {"error": "project_id must be a valid id"}
    elif ctx.project_id:
        project_id = ctx.project_id
    return {"playbooks": await list_workstreams(ctx.session, ctx.tenant_id, project_id=project_id)}


async def _get_playbook(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from fastapi import HTTPException

    from app.services.workstreams import (
        get_workstream,
        serialize_workstream,
    )

    raw = str(tool_input.get("playbook_id") or tool_input.get("workstream_id") or "").strip()
    if not raw:
        return {"error": "playbook_id is required"}
    try:
        playbook_id = UUID(raw)
    except ValueError:
        return {"error": "playbook_id must be a valid id"}
    try:
        workstream = await get_workstream(ctx.session, ctx.tenant_id, playbook_id)
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    return serialize_workstream(workstream)


async def _list_triggers(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.models.trigger import Trigger
    from app.services.triggers import serialize_trigger

    stmt = select(Trigger).where(Trigger.tenant_id == ctx.tenant_id)
    kind = str(tool_input.get("kind") or "").strip()
    if kind:
        stmt = stmt.where(Trigger.kind == kind)
    if tool_input.get("enabled_only") is True:
        stmt = stmt.where(Trigger.enabled.is_(True))
    limit = max(1, min(int(tool_input.get("limit") or 50), 100))
    rows = (
        await ctx.session.execute(stmt.order_by(Trigger.created_at).limit(limit))
    ).scalars().all()
    return {"triggers": [serialize_trigger(row) for row in rows]}


_DECISION_ACTIONS = {
    "approve": "approved",
    "approved": "approved",
    "reject": "rejected",
    "rejected": "rejected",
    "defer": "deferred",
    "deferred": "deferred",
}


async def _resolve_decision(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Answer a pending decision card the same way the inbox does."""
    from app.services.notifications import DecisionActionError
    from app.services.notifications import resolve_decision as resolve

    raw = str(tool_input.get("decision_id") or "").strip()
    try:
        decision_id = UUID(raw)
    except ValueError:
        return {"error": "decision_id must be a valid id"}
    action = _DECISION_ACTIONS.get(str(tool_input.get("action") or "").strip().lower())
    if action is None:
        return {"error": "action must be approve, reject, or defer"}

    decision = (
        await ctx.session.execute(
            select(DecisionRequest).where(
                DecisionRequest.id == decision_id,
                DecisionRequest.tenant_id == ctx.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if decision is None:
        return {"error": "Decision not found"}
    if decision.status != "awaiting_human":
        return {
            "error": f"Decision is already {decision.status}",
            "decision_id": str(decision.id),
            "status": decision.status,
        }

    try:
        options = json.loads(decision.options_json or "[]")
    except json.JSONDecodeError:
        options = []
    option_ids = [str(o.get("id")) for o in options if isinstance(o, dict) and o.get("id")]
    option_id = str(tool_input.get("chosen_option_id") or "").strip()
    if option_id:
        if option_ids and option_id not in option_ids:
            return {"error": f"Unknown option. Choose one of: {', '.join(option_ids)}"}
    elif action == "approved":
        # Approving runs the option's action, so never guess between choices.
        actionable = [
            str(o.get("id"))
            for o in options
            if isinstance(o, dict)
            and o.get("id")
            and str(o.get("action_type") or "") not in ("reject", "defer")
        ]
        if len(actionable) != 1:
            return {
                "error": "chosen_option_id is required",
                "options": options,
            }
        option_id = actionable[0]
    else:
        option_id = "reject" if action == "rejected" else "defer"

    try:
        resolved = await resolve(
            ctx.session,
            ctx.tenant_id,
            decision_id,
            option_id,
            action,
            user_id=ctx.user_id,
        )
    except ValueError as exc:
        return {"error": str(exc)}
    except DecisionActionError as exc:
        return {"error": str(exc.detail), "decision_id": str(decision_id), "status": "awaiting_human"}
    return {
        "decision_id": str(resolved.id),
        "status": resolved.status,
        "chosen_option_id": resolved.chosen_option_id,
        "title": resolved.title,
    }


register_tool(
    ToolSpec(
        name="list_agents",
        description=(
            "List the agents in this workspace (name, description, slug, role, "
            "autonomy level, active flag, path, mention). Auto-showcases agent "
            "cards on the reply. In prose chip one name with mention or "
            "[Name](/agents/{id}) from path — never a plain bold name. Pass "
            "include_inactive to also see paused agents."
        ),
        category="agents",
        input_schema={
            "type": "object",
            "properties": {"include_inactive": {"type": "boolean"}},
        },
        handler=_list_agents,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="get_agent",
        description=(
            "Read one agent by id or slug, including its description, purpose "
            "(system prompt), tool passport, path and mention. Showcases a card "
            "and returns mention/path for an inline chip in chat."
        ),
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "agent_slug": {"type": "string"},
            },
        },
        handler=_get_agent,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_playbooks",
        description=(
            "List playbooks (workstreams) with their step counts. Scoped to a "
            "project when project_id is given or the run is project-scoped."
        ),
        category="agents",
        input_schema={
            "type": "object",
            "properties": {"project_id": {"type": "string"}},
        },
        handler=_list_playbooks,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="get_playbook",
        description="Read one playbook (workstream) with its ordered steps.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "playbook_id": {"type": "string"},
                "workstream_id": {"type": "string"},
            },
        },
        handler=_get_playbook,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_triggers",
        description=(
            "List Agenda triggers (cron, interval, heartbeat, webhook, once) with "
            "their schedule, last status, and next run."
        ),
        category="triggers",
        input_schema={
            "type": "object",
            "properties": {
                "kind": {"type": "string"},
                "enabled_only": {"type": "boolean"},
                "limit": {"type": "integer"},
            },
        },
        handler=_list_triggers,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="resolve_decision",
        description=(
            "Answer a pending decision card: approve, reject, or defer it. "
            "Approving runs the chosen option's action, so pass "
            "chosen_option_id whenever the card offers more than one real "
            "choice. Always asks a human first."
        ),
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "decision_id": {"type": "string"},
                "action": {"type": "string", "enum": ["approve", "reject", "defer"]},
                "chosen_option_id": {"type": "string"},
            },
            "required": ["decision_id", "action"],
        },
        handler=_resolve_decision,
        mutating=True,
        gated=True,
        consequential=True,
    )
)


async def _list_trash(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.trash import list_entries

    return await list_entries(
        ctx.session,
        ctx.tenant_id,
        resource_type=tool_input.get("type"),
        q=tool_input.get("q"),
        limit=int(tool_input.get("limit") or 30),
    )


async def _restore_trash_item(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.services.trash import get_entry, load_tenant, restore_entry

    entry_id = _UUID(str(tool_input.get("id") or ""))
    tenant = await load_tenant(ctx.session, ctx.tenant_id)
    entry = await get_entry(ctx.session, ctx.tenant_id, entry_id)
    return await restore_entry(ctx.session, tenant, entry, user_id=ctx.user_id)


register_tool(
    ToolSpec(
        name="list_trash",
        description=(
            "List items currently in the workspace Bin (soft-deleted, recoverable). "
            "Omit type to see every kind. Conversations are type 'conversation' "
            "(also accept signal/thread). Other types: project, canvas, knowledge, "
            "contact, company, playbook, trigger, team, inbox_rule, saved_reply."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "description": (
                        "Optional Bin type. Use conversation for deleted chats "
                        "(aliases: signal, thread). Leave empty to list all."
                    ),
                },
                "q": {"type": "string"},
                "limit": {"type": "integer"},
            },
        },
        handler=_list_trash,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="restore_trash_item",
        description=(
            "Restore an item from the workspace Bin. This is consequential: "
            "calling it raises an Approve/Reject card for the operator — do not "
            "only ask in chat whether to restore; call this tool with the item "
            "id so they can approve. Restoring a child while the parent is "
            "still in the Bin fails until the parent is restored."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
        handler=_restore_trash_item,
        mutating=True,
        gated=True,
        consequential=True,
    )
)
