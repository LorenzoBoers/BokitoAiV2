"""Built-in tool implementations, registered into the unified registry."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models.auth import Tenant
from app.models.notification import DecisionRequest, Notification
from app.tools.registry import ToolContext, ToolSpec, register_tool


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
    )
    if meta.get("mode") == "apply":
        return meta.get("applied", {"status": "applied", "mode": "apply"})
    return {
        "change_id": str(change.id),
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
    )
    from_display_name = await resolve_from_display_name(
        ctx.session,
        ctx.tenant_id,
        send_as=send_as,
        user_id=ctx.user_id,
        agent_id=identity_agent_id,
    )

    delivery_result = await deliver_outbound(
        ctx.session,
        signal,
        body_text=body_text,
        subject=subject,
        body_html=body_html if isinstance(body_html, str) else None,
        signature_html=signature_html,
        from_display_name=from_display_name,
    )
    delivery = delivery_result.status
    if delivery == "skipped":
        # Channels without provider delivery (widget/chat): the visitor
        # receives the message live via the gateway publish below.
        delivery = "sent"
    if not delivery.startswith("sent"):
        return {"error": f"Delivery failed: {delivery}", "delivery": delivery}

    stored_html = delivery_result.body_html or (
        body_html if isinstance(body_html, str) else ""
    )

    as_user = send_as == "user"
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
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=ctx.tenant_id,
        kind="user_message" if as_user else "agent_message",
        direction="outbound",
        role="user" if as_user else "assistant",
        author_agent_id=None if as_user else identity_agent_id,
        author_user_id=ctx.user_id if as_user else None,
        subject=subject,
        body_text=body_text,
        body_html=stored_html,
        body_preview=body_text[:200],
        send_status=delivery,
        auto_sent=False,
        received_at=datetime.utcnow(),
        metadata_json=json.dumps(metadata),
    )
    ctx.session.add(message)
    signal.last_message_at = datetime.utcnow()
    signal.updated_at = datetime.utcnow()
    ctx.session.add(signal)
    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="replied",
            actor_type="user" if as_user else "agent",
            actor_id=str(ctx.user_id if as_user else identity_agent_id or ""),
            payload_json=json.dumps(
                {"delivery": delivery, "via": "send_reply", "send_as": send_as}
            ),
        )
    )
    await ctx.session.flush()
    await publish_signal_message(signal, message)
    return {
        "ok": True,
        "delivery": delivery,
        "message_id": str(message.id),
        "signal_id": str(signal.id),
    }


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

    signal.agent_id = ctx.agent.id
    signal.ai_paused = False
    signal.assigned_user_id = None
    signal.updated_at = datetime.utcnow()
    ctx.session.add(signal)
    ctx.session.add(
        SignalEvent(
            signal_id=signal.id,
            tenant_id=ctx.tenant_id,
            event_type="ai_resumed",
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
        "ai_paused": False,
        "handling_agent": ctx.agent.name,
        "note": (
            "You now handle this conversation and answer the next inbound "
            "message. Use suggest_thread_reply if you want to propose the "
            "next reply for approval first."
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
    if not signal:
        return {"error": "Signal not found"}
    if signal.status == "closed":
        return {"ok": True, "signal_id": str(signal.id), "status": "closed", "already_closed": True}

    signal.status = "closed"
    signal.snoozed_until = None
    signal.has_unread = False
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


async def _set_thread_tags(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Add tags to a signal thread from the tenant's tag registry.

    Union merge only: agents never remove operator tags, and can only apply
    tags that are registered (same constraint as AI triage).
    """
    from datetime import datetime

    from app.gateway.publish import publish_thread_update
    from app.models.signal import Signal, SignalEvent
    from app.services.signal_tags import allowed_tag_names, normalize_tag

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

    catalog = set(await allowed_tag_names(ctx.session, ctx.tenant_id))
    allowed: list[str] = []
    rejected: list[str] = []
    for raw in requested:
        name = normalize_tag(raw) if isinstance(raw, str) else ""
        if not name:
            continue
        (allowed if name in catalog else rejected).append(name)
    if not allowed:
        return {
            "error": "None of the requested tags exist in the tag registry",
            "rejected": rejected,
            "catalog": sorted(catalog)[:30],
        }

    try:
        existing = json.loads(signal.tags_json or "[]")
    except json.JSONDecodeError:
        existing = []
    if not isinstance(existing, list):
        existing = []
    added = [t for t in allowed if t not in existing]
    if added:
        signal.tags_json = json.dumps([*existing, *added])
        signal.updated_at = datetime.utcnow()
        ctx.session.add(signal)
        ctx.session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=ctx.tenant_id,
                event_type="thread_updated",
                actor_type="agent" if ctx.agent else "user",
                actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
                payload_json=json.dumps({"tags": [*existing, *added], "via": "set_thread_tags"}),
            )
        )
        await ctx.session.flush()
        await publish_thread_update(signal)
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "added": added,
        "tags": [*existing, *added],
        "rejected": rejected,
    }


async def _handoff_to_human(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Escalate a conversation to the team: pause AI replies, alert operators.

    The visitor keeps chatting in the same thread; a team member takes over
    from the inbox (``Signal.ai_paused`` silences the agent until released).
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
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "ai_paused": True,
        "note": (
            "The team has been notified and AI replies are paused on this thread. "
            "Tell the visitor a team member will take over in this same conversation."
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
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
    )
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "ai_paused": False,
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
    if target_signal_id:
        # A newer identical ask supersedes the stale card: without this the
        # thread stacks duplicate pending decisions every time the customer
        # writes again before anyone resolved the previous draft.
        from datetime import datetime

        stale_result = await ctx.session.execute(
            select(DecisionRequest).where(
                DecisionRequest.tenant_id == ctx.tenant_id,
                DecisionRequest.signal_id == target_signal_id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.platform_change_id.is_(None),
                DecisionRequest.title == tool_input["title"],
            )
        )
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

    decision, _ = await create_decision(
        ctx.session,
        ctx.tenant_id,
        title=tool_input["title"],
        summary=tool_input.get("summary", ""),
        options=tool_input.get("options", []),
        user_id=ctx.user_id,
        agent_id=ctx.agent.id if ctx.agent else None,
        signal_id=target_signal_id,
        project_id=project_uuid,
        agent_task_id=task_uuid,
        run_id=ctx.run_id,
        notification_payload=tool_input,
    )
    await ctx.session.commit()
    return {"decision_request_id": str(decision.id), "status": "awaiting_human"}


async def _suggest_integration(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.integrations_catalog import PROVIDER_BY_SLUG

    provider = str(tool_input["provider"])
    catalog = PROVIDER_BY_SLUG.get(provider)
    display_name = catalog["name"] if catalog else provider.replace("_", " ").title()
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
    from app.services.inbox_rules import suggest_rule

    payload = await suggest_rule(
        ctx.session,
        ctx.tenant_id,
        match_type=str(tool_input.get("match_type") or "sender"),
        match_value=str(tool_input.get("match_value") or ""),
        action=str(tool_input.get("action") or ""),
        label=str(tool_input.get("label") or ""),
        source="agent",
        reason=str(tool_input.get("reason") or ""),
    )
    if payload is None:
        return {
            "error": (
                "Rule not suggested: invalid match/action, or a rule for this "
                "sender already exists (active or paused)."
            )
        }
    await ctx.session.commit()
    return {
        "rule": payload,
        "confirm_path": "/settings/channels#automation-rules",
        "note": (
            "Suggested only — the operator must activate it. Tell them with an "
            "in-app markdown link, e.g. "
            "[Automation rules](/settings/channels#automation-rules). "
            "Do not write plain breadcrumbs like Inbox > Automation rules."
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
    from uuid import UUID

    from app.services.agent.style import strip_emoji
    from app.services.orchestration.dispatcher import create_agent_task

    agent_id = UUID(str(tool_input["agent_id"])) if tool_input.get("agent_id") else (ctx.agent.id if ctx.agent else None)
    task = await create_agent_task(
        ctx.session,
        ctx.tenant_id,
        title=strip_emoji(str(tool_input.get("title", ""))) or "Agent task",
        description=tool_input.get("description", ""),
        agent_id=agent_id,
        project_id=UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else None,
        workstream_id=UUID(str(tool_input["workstream_id"])) if tool_input.get("workstream_id") else None,
        signal_id=ctx.signal_id,
        created_by=ctx.user_id,
        auto_start=tool_input.get("auto_start", True),
    )
    return {
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


# ── integrations ─────────────────────────────────────────────────


async def _call_mcp_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent.mcp_client import call_mcp_tool

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

        row = (
            await ctx.session.execute(
                select(Workstream).where(
                    Workstream.id == UUID(str(after["workstream_id"])),
                    Workstream.tenant_id == ctx.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row:
            return {
                "workstream_id": str(row.id),
                "name": row.name,
                "description": row.description,
                "enabled": row.enabled,
            }
    if resource_type == "case_type" and after.get("case_type_id"):
        from app.models.case import CaseType

        row = (
            await ctx.session.execute(
                select(CaseType).where(
                    CaseType.id == UUID(str(after["case_type_id"])),
                    CaseType.tenant_id == ctx.tenant_id,
                )
            )
        ).scalar_one_or_none()
        if row:
            return {
                "case_type_id": str(row.id),
                "name": row.name,
                "description": row.description,
                "create_mode": row.create_mode,
                "ask_threshold": row.ask_threshold,
                "auto_threshold": row.auto_threshold,
                "requires_verification": row.requires_verification,
                "audience": row.audience,
                "enabled": row.enabled,
            }
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
        name="set_thread_tags",
        description=(
            "Add tags to a conversation thread. Only tags that already exist in the "
            "workspace tag catalog are applied; existing tags are never removed."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["tags"],
        },
        handler=_set_thread_tags,
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
            "Ask the team to get back to this visitor later. Use when the team "
            "is not reachable for a live handoff. Chat stays open; do not say "
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
            "takes over with no outbound mail."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "signal_id": {"type": "string"},
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
        description="Call a tool on a registered external MCP server.",
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
        description="Create an orchestration task for an agent (starts internal thread + optional workstream segment).",
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
        name="create_agent",
        description="Create a new AI agent in the tenant.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "role": {"type": "string"},
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
        description="Update an existing agent (name, prompt, role).",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "name": {"type": "string"},
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
        description="Create an orchestration workstream.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {"name": {"type": "string"}, "description": {"type": "string"}},
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
        description="Update a workstream (name, status, enabled).",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "workstream_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "enabled": {"type": "boolean"},
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

register_tool(
    ToolSpec(
        name="add_graph_node",
        description="Add a canvas node for an existing domain entity.",
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
        handler=_make_platform_handler(
            "add_graph_node", "canvas_node", "create", lambda i: f"Add canvas node {i.get('node_type')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="connect_graph_nodes",
        description="Connect two canvas nodes with a relation edge.",
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
        handler=_make_platform_handler(
            "connect_graph_nodes", "canvas_edge", "connect", lambda i: "Connect canvas nodes"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="create_case_type",
        description="Propose a new intake type (complaint, bug, billing, …). Structural — goes through Govern.",
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "slug": {"type": "string"},
                "description": {"type": "string"},
                "create_mode": {
                    "type": "string",
                    "enum": ["ask_customer", "ask_operator", "auto", "manual_only"],
                },
                "ask_threshold": {"type": "integer"},
                "auto_threshold": {"type": "integer"},
                "requires_verification": {"type": "boolean"},
                "audience": {"type": "string", "enum": ["customer", "internal", "both"]},
            },
            "required": ["name"],
        },
        handler=_make_platform_handler(
            "create_case_type", "case_type", "create", lambda i: f"Create intake type {i.get('name')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="update_case_type",
        description="Propose an update to an intake type (mode, thresholds, enabled).",
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "case_type_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "create_mode": {"type": "string"},
                "ask_threshold": {"type": "integer"},
                "auto_threshold": {"type": "integer"},
                "requires_verification": {"type": "boolean"},
                "enabled": {"type": "boolean"},
                "audience": {"type": "string"},
            },
            "required": ["case_type_id"],
        },
        handler=_make_platform_handler(
            "update_case_type", "case_type", "update", lambda i: f"Update intake type {i.get('case_type_id')}"
        ),
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="bind_case_type",
        description="Propose routing an intake type to a workstream or project.",
        category="govern",
        input_schema={
            "type": "object",
            "properties": {
                "case_type_id": {"type": "string"},
                "target_kind": {"type": "string", "enum": ["workstream", "project"]},
                "target_id": {"type": "string"},
                "priority": {"type": "integer"},
                "auto_link": {"type": "boolean"},
                "auto_start_run": {"type": "boolean"},
            },
            "required": ["case_type_id", "target_kind", "target_id"],
        },
        handler=_make_platform_handler(
            "bind_case_type",
            "case_type_binding",
            "create",
            lambda i: f"Bind intake type {i.get('case_type_id')} to {i.get('target_kind')}",
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

    items = await list_threads_summary(
        ctx.session,
        ctx.tenant_id,
        status=tool_input.get("status", "open"),
        channel=tool_input.get("channel"),
        limit=int(tool_input.get("limit") or 25),
    )
    return {"threads": items}


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
            "Summarize Signal threads (subject, channel, status, last activity). "
            "Defaults to open/pending threads. Optional channel filter (internal, assistant, widget, email)."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "status": {"type": "string"},
                "channel": {"type": "string"},
                "limit": {"type": "integer"},
            },
        },
        handler=_list_threads,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="get_platform_watch",
        description=(
            "Show whether the workspace check-in is on. The check-in is the "
            "assistant waking on a timer, reading heartbeat.md, and posting "
            "only when something needs attention — in your own channel in "
            "Communication, where the operator already talks to you."
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
            "watch the workspace yourself; findings land in your own channel."
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
        parsed = parsed.astimezone(tz=None).replace(tzinfo=None)
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
    agent_id = (
        _UUID(str(tool_input["agent_id"]))
        if tool_input.get("agent_id")
        else (ctx.agent.id if ctx.agent else None)
    )
    user_id = _UUID(str(tool_input["user_id"])) if tool_input.get("user_id") else None
    task = await create_agent_task(
        ctx.session,
        ctx.tenant_id,
        title=strip_emoji(str(tool_input.get("title", ""))) or "Planned task",
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


async def _schedule_wake(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Create a Trigger that wakes an agent once or on a recurring schedule."""
    from uuid import UUID as _UUID

    from app.services.triggers import create_trigger, serialize_trigger

    agent_id = (
        _UUID(str(tool_input["agent_id"]))
        if tool_input.get("agent_id")
        else (ctx.agent.id if ctx.agent else None)
    )
    if agent_id is None:
        return {"error": "No agent to wake: pass agent_id or call as an agent."}
    instructions = str(tool_input.get("instructions") or "").strip()
    if not instructions:
        return {"error": "instructions is required: what should the agent do on wake?"}
    name = str(tool_input.get("name") or "").strip() or instructions[:60]

    run_at = _parse_when(tool_input.get("at"))
    cron_expr = str(tool_input.get("cron") or "").strip()
    try:
        every_minutes = int(tool_input.get("every_minutes") or 0)
    except (TypeError, ValueError):
        every_minutes = 0
    if run_at is not None:
        kind, interval = "once", 0
    elif cron_expr:
        kind, interval = "cron", 0
    elif every_minutes > 0:
        kind, interval = "interval", max(5, every_minutes)
    else:
        return {"error": "Pass one of: at (ISO datetime), cron (5-field), or every_minutes."}

    from fastapi import HTTPException

    try:
        trigger = await create_trigger(
            ctx.session,
            ctx.tenant_id,
            name=name,
            kind=kind,
            cron_expr=cron_expr,
            interval_minutes=interval,
            agent_id=agent_id,
            instructions=instructions,
            run_at=run_at,
        )
    except HTTPException as exc:
        return {"error": str(exc.detail)}
    return {"trigger": serialize_trigger(trigger)}


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

register_tool(
    ToolSpec(
        name="schedule_wake",
        description=(
            "Schedule an agent wake as an Agenda trigger: once at a specific time "
            "(at), on a cron schedule (cron), or every N minutes (every_minutes). "
            "Wakes yourself by default or a peer agent via agent_id. Use for "
            "'check this again Friday' or recurring follow-ups."
        ),
        category="triggers",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "instructions": {"type": "string", "description": "What the agent should do on wake."},
                "agent_id": {"type": "string", "description": "Peer agent to wake (default: yourself)."},
                "at": {"type": "string", "description": "ISO datetime for a one-off wake."},
                "cron": {"type": "string", "description": "5-field cron expression for recurring wakes."},
                "every_minutes": {"type": "integer", "description": "Interval wake in minutes (min 5)."},
            },
            "required": ["instructions"],
        },
        handler=_schedule_wake,
        mutating=True,
        gated=True,
    )
)
