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


async def _list_docs(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import list_docs, serialize_doc

    docs = await list_docs(ctx.session, ctx.tenant_id, kind=tool_input.get("kind"))
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


async def _write_doc(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import get_doc_by_path

    path = tool_input["path"]
    mode = tool_input.get("mode", "append")
    existing = await get_doc_by_path(ctx.session, ctx.tenant_id, path)
    before = None
    if existing:
        before = {"path": existing.path, "content": existing.content, "kind": existing.kind}
    return await _platform_change(
        ctx,
        resource_type="workspace_doc",
        change_kind="update" if existing else "create",
        summary=f"{'Update' if existing else 'Create'} workspace doc {path}",
        after={
            "path": path,
            "content": tool_input["content"],
            "mode": mode if existing else "replace",
            "kind": tool_input.get("kind"),
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

    subject = str(tool_input.get("subject") or "").strip()
    if not subject:
        subject = f"Re: {signal.subject}" if signal.subject else "Reply"

    to_override = str(tool_input.get("to") or "").strip()
    if to_override and not signal.contact_email:
        signal.contact_email = to_override

    delivery = await deliver_outbound(
        ctx.session,
        signal,
        body_text=body_text,
        subject=subject,
        body_html=body_html if isinstance(body_html, str) else None,
    )
    if delivery == "skipped":
        # Channels without provider delivery (widget/chat): the visitor
        # receives the message live via the gateway publish below.
        delivery = "sent"
    if not delivery.startswith("sent"):
        return {"error": f"Delivery failed: {delivery}", "delivery": delivery}

    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=ctx.tenant_id,
        kind="agent_message",
        direction="outbound",
        role="assistant" if ctx.agent else "user",
        author_agent_id=ctx.agent.id if ctx.agent else None,
        author_user_id=ctx.user_id,
        subject=subject,
        body_text=body_text,
        body_html=body_html if isinstance(body_html, str) else "",
        body_preview=body_text[:200],
        send_status=delivery,
        auto_sent=False,
        received_at=datetime.utcnow(),
        metadata_json=json.dumps({"source": "send_reply_tool", "delivery": delivery}),
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
            actor_type="agent" if ctx.agent else "user",
            actor_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
            payload_json=json.dumps({"delivery": delivery, "via": "send_reply"}),
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
    notification = Notification(
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        kind="decision_request",
        title=tool_input["title"],
        body=tool_input.get("summary", ""),
        payload_json=json.dumps(tool_input),
    )
    ctx.session.add(notification)
    await ctx.session.flush()
    from app.gateway.publish import publish_notification

    await publish_notification(
        ctx.tenant_id,
        notification_id=notification.id,
        kind=notification.kind,
        title=notification.title,
    )
    project_uuid = None
    raw_project = tool_input.get("project_id")
    if raw_project:
        try:
            project_uuid = UUID(str(raw_project))
        except ValueError:
            project_uuid = None
    decision = DecisionRequest(
        tenant_id=ctx.tenant_id,
        notification_id=notification.id,
        title=tool_input["title"],
        summary=tool_input.get("summary", ""),
        options_json=json.dumps(tool_input.get("options", [])),
        status="awaiting_human",
        project_id=project_uuid,
    )
    ctx.session.add(decision)
    await ctx.session.flush()
    from app.services.signal_decisions import ingest_decision_request

    await ingest_decision_request(
        ctx.session,
        ctx.tenant_id,
        notification,
        decision,
        user_id=ctx.user_id,
        agent_id=ctx.agent.id if ctx.agent else None,
        signal_id=target_signal_id,
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


async def _propose_integration(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    return await _suggest_integration(
        ctx,
        {
            "provider": tool_input["provider"],
            "reason": tool_input.get("reason", ""),
            "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
        },
    )


async def _record_metric(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Append a value to a custom cockpit metric (creates the metric if new)."""
    from app.services.metrics import create_metric, get_metric_by_key, normalize_metric_key, record_metric_point

    key = normalize_metric_key(str(tool_input.get("key") or tool_input.get("label") or ""))
    if not key:
        return {"error": "key or label required"}
    raw_value = tool_input.get("value")
    try:
        value = float(raw_value)
    except (TypeError, ValueError):
        return {"error": "value must be a number"}

    metric = await get_metric_by_key(ctx.session, ctx.tenant_id, key)
    if metric is None:
        try:
            metric = await create_metric(
                ctx.session,
                ctx.tenant_id,
                key=key,
                label=str(tool_input.get("label") or key),
                description=str(tool_input.get("description") or ""),
                unit=str(tool_input.get("unit") or "number"),
            )
        except ValueError as exc:
            return {"error": str(exc)}
    point = await record_metric_point(
        ctx.session,
        ctx.tenant_id,
        metric,
        value=value,
        note=str(tool_input.get("note") or ""),
        source="agent",
        recorded_by=str(ctx.agent.id) if ctx.agent else "agent",
    )
    await ctx.session.commit()
    return {
        "metric_id": str(metric.id),
        "key": metric.key,
        "label": metric.label,
        "unit": metric.unit,
        "value": point.value,
        "recorded_at": point.recorded_at.isoformat(),
    }


async def _list_metrics(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """List the tenant's custom metrics with their latest values."""
    from app.services.metrics import list_metrics_with_latest

    items = await list_metrics_with_latest(ctx.session, ctx.tenant_id)
    return {
        "metrics": [
            {
                "key": m["key"],
                "label": m["label"],
                "unit": m["unit"],
                "target": m["target"],
                "latest_value": m["latest_value"],
                "latest_at": m["latest_at"],
                "delta": m["delta"],
            }
            for m in items
        ]
    }


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
        name="list_docs",
        description="List workspace docs (path, kind, title). Filter by kind: doc, memory, persona, skill, daily_log, heartbeat.",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"kind": {"type": "string"}},
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
        description="Create or update a workspace markdown doc. mode=append adds to the end; mode=replace overwrites.",
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "mode": {"type": "string", "enum": ["append", "replace"]},
                "kind": {"type": "string"},
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
            },
            "required": [],
        },
        handler=_send_reply,
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
        name="create_decision_request",
        description=(
            "Ask the human to choose between concrete options via an inline card. "
            "Set input_type to 'text' on an option to let the human answer with "
            "free text instead of clicking a fixed choice."
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
    )
)

register_tool(
    ToolSpec(
        name="record_metric",
        description=(
            "Record a value for a custom cockpit KPI. Creates the metric on first "
            "use. Use for business numbers worth tracking over time (revenue, "
            "open tickets, response time, ...)."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Stable metric slug, e.g. open_tickets"},
                "label": {"type": "string", "description": "Human label shown on the Cockpit"},
                "value": {"type": "number"},
                "unit": {
                    "type": "string",
                    "enum": ["number", "percent", "currency", "duration", "count"],
                },
                "note": {"type": "string", "description": "Optional context for this data point"},
                "description": {"type": "string"},
            },
            "required": ["value"],
        },
        handler=_record_metric,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_metrics",
        description="List the workspace's custom cockpit metrics with their latest values.",
        category="workspace",
        input_schema={"type": "object", "properties": {}},
        handler=_list_metrics,
        mutating=False,
        gated=False,
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
        category="agents",
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
        category="agents",
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
        category="agents",
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
