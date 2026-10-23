"""Read tools: search, docs, overview, agents, flows, triggers."""

from __future__ import annotations

import logging
import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.exceptions import AppError
from app.models.auth import Tenant
from app.tools._common import (

    _parse_when,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool



logger = logging.getLogger(__name__)

# ── workspace / knowledge ────────────────────────────────────────


async def _search_index(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import conversation_tag_ids, hybrid_search

    tag_ids = None
    if ctx.signal_id:
        tag_ids = await conversation_tag_ids(ctx.session, ctx.tenant_id, ctx.signal_id) or None
    results = await hybrid_search(
        ctx.session,
        ctx.tenant_id,
        tool_input.get("query", ""),
        tool_input.get("top_k", 8),
        agent_id=ctx.agent.id if ctx.agent is not None else None,
        tag_ids=tag_ids,
    )
    return {"results": results}


async def _web_search(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.web_search import web_search

    result = await web_search(
        str(tool_input.get("query") or ""),
        count=int(tool_input.get("count") or 5),
        kind=str(tool_input.get("kind") or "web"),
    )
    # Titles are not the page. The model stopped here and told the operator
    # it could not browse, then guessed a year.
    if (
        isinstance(result, dict)
        and not result.get("error")
        and str(result.get("kind") or "web") != "images"
        and result.get("results")
    ):
        result = {
            **result,
            "next": (
                "These are links, not the answer. Call fetch_url on the url "
                "that matches the question before you reply. Do not tell the "
                "operator you cannot browse."
            ),
        }
    return result


async def _fetch_url(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.web_fetch import fetch_url_markdown

    return await fetch_url_markdown(str(tool_input.get("url") or ""))


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


async def _get_operator_settings(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Read the chatting person's UI prefs and workspace language (deep-link ready)."""

    from app.models.auth import User
    from app.services.language import (
        LANGUAGE_NAMES,
        platform_default_ui_language,
        resolve_workspace_language,
    )

    if not ctx.user_id:
        return {"error": "No operator in this session"}
    user = await ctx.session.get(User, ctx.user_id)
    if not user:
        return {"error": "Operator not found"}
    try:
        stored = json.loads(user.settings_json or "{}")
    except json.JSONDecodeError:
        stored = {}
    if not isinstance(stored, dict):
        stored = {}
    ui = stored.get("ui_language")
    if ui not in ("en", "nl"):
        ui = platform_default_ui_language()
    tenant = await ctx.session.get(Tenant, ctx.tenant_id)
    workspace = resolve_workspace_language(tenant)
    from app.services.operator_prefs import normalize_default_landing

    landing = normalize_default_landing(stored.get("default_landing"))
    return {
        "user": {
            "id": str(user.id),
            "name": (user.display_name or "").strip() or user.email,
            "email": user.email,
            "ui_language": ui,
            "ui_language_name": LANGUAGE_NAMES.get(ui, ui),
            "ui_language_path": "/settings/profile",
            "ui_language_label": "Settings → Profile & security → Language",
            "default_landing": landing,
            "default_landing_path": "/settings/profile",
            "close_email_on_send": stored.get("close_email_on_send") is True,
            "close_email_on_send_path": "/settings/profile",
            "close_email_on_send_label": "Settings → Profile & security → Close email when I send",
        },
        "workspace": {
            "working_language": workspace,
            "working_language_name": LANGUAGE_NAMES.get(workspace, workspace),
            "working_language_path": "/settings/communication",
            "working_language_label": "Settings → Communication → Organization working language",
            "general_path": "/settings/general",
            "branding_path": "/settings/branding",
            "channels_path": "/settings/channels",
            "ai_handling_path": "/settings/ai-handling",
        },
        "hint": (
            "Dashboard UI language is per person at /settings/profile. "
            "Organization working language is per workspace at /settings/communication. "
            "Link those paths; do not claim Dutch or English UI is unavailable."
        ),
    }


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
    rows = [serialize_doc(d, include_content=False) for d in docs]
    return {"docs": rows}


async def _read_doc(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.workspace import get_doc_by_path, serialize_doc

    doc = await get_doc_by_path(ctx.session, ctx.tenant_id, tool_input["path"])
    if not doc:
        return {"error": f"Doc {tool_input['path']} not found"}
    return serialize_doc(doc)


async def _write_doc(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.platform import _platform_change, _workstream_id
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
    # a playbook-attributed run only. A human live in the session (user_id set),
    # a human-gated proposal (mode "ask"), and non-project docs stay direct.
    ws_ref = await _workstream_id(ctx)
    if (
        ctx.agent is not None
        and ctx.user_id is None
        and ctx.mode == "apply"
        and project_id
        and ws_ref is None
    ):
        return {
            "error": (
                "Folder docs are agent-editable only inside a flow run. "
                "Route this work through a folder flow (a queue item or "
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
            "workstream_id": str(ws_ref) if ws_ref else None,
        },
        before=before,
        tool_name="write_doc",
    )


# ── integrations ─────────────────────────────────────────────────


async def _call_mcp_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent.mcp_client import call_mcp_tool
    from app.services.connection_scope import mcp_server_denial, record_denial

    from app.services.agent_definition import mcp_server_allowed

    agent_id = ctx.agent.id if ctx.agent is not None else None
    if not mcp_server_allowed(ctx.agent, str(tool_input.get("server_name") or "")):
        return {
            "error": "This agent does not inherit that MCP server",
            "status": "denied",
            "reason": "mcp_inheritance",
        }
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


async def _list_mcp_tools(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent_definition import mcp_server_allowed
    from app.services.mcp_remote_client import cached_tools

    name = str(tool_input.get("server_name") or "").strip()
    if not mcp_server_allowed(ctx.agent, name):
        return {"error": "This agent does not inherit that MCP server", "status": "denied"}
    server, tools = await cached_tools(ctx.session, ctx.tenant_id, name)
    if server is None:
        return {"error": f"MCP server {name} not found"}
    wanted = str(tool_input.get("tool_name") or "").strip()
    if wanted:
        tools = [t for t in tools if t.get("name") == wanted]
    return {
        "server": server.name,
        "synced_at": server.tools_synced_at.isoformat() if server.tools_synced_at else None,
        "tools": [
            {
                "name": t.get("name"),
                "description": t.get("description", ""),
                "input_schema": t.get("input_schema") or {},
                "read_only": bool((t.get("annotations") or {}).get("readOnlyHint"))
                and not (t.get("annotations") or {}).get("destructiveHint"),
            }
            for t in tools[:60]
        ],
    }


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
        untrusted_output=True,
    )
)

register_tool(
    ToolSpec(
        name="web_search",
        description=(
            "Search the open web. Use for current facts, news, or public pages "
            "outside this workspace. kind=web returns titles, urls, snippets; "
            "kind=images returns image urls. To read a result page in full, call "
            "fetch_url with its url. To show images in chat, call attach_items "
            "with type image and each result's image_url. Prefer search_index / "
            "search_product_help for Bokito and workspace data."
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
        untrusted_output=True,
        audience="both",
        display_name="Web search",
    )
)

register_tool(
    ToolSpec(
        name="fetch_url",
        description=(
            "Fetch a public http(s) page and return clean Markdown. Use after "
            "web_search when snippets are not enough, or when the user gives a "
            "specific URL. Does not crawl whole sites — one URL per call. Prefer "
            "search_index / read_doc / search_product_help for workspace and "
            "Bokito content. Private or local network URLs are blocked."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Absolute http or https URL to fetch",
                },
            },
            "required": ["url"],
        },
        handler=_fetch_url,
        mutating=False,
        gated=False,
        untrusted_output=True,
        audience="both",
        display_name="Fetch page",
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
        name="get_operator_settings",
        description=(
            "Read the chatting person's dashboard UI language and start page, plus "
            "this workspace's working language and common Settings paths. Use when "
            "someone asks why the interface is English/Dutch, where to change "
            "language, branding, channels, or Autonomy. Link the returned paths "
            "(especially /settings/profile for UI language). Does not change anything."
        ),
        category="workspace",
        input_schema={"type": "object", "properties": {}},
        handler=_get_operator_settings,
        mutating=False,
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
            "folder-scoped run new docs become folder documentation "
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
                    "description": "Scope the doc to a folder (smart documentation).",
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
        untrusted_output=True,
    )
)

register_tool(
    ToolSpec(
        name="list_mcp_tools",
        description=(
            "List the tools of a connected MCP server with their argument schema and "
            "whether they only read. Call this before call_mcp_tool when you do not "
            "know the exact arguments."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "server_name": {"type": "string"},
                "tool_name": {"type": "string", "description": "Optional: one tool only."},
            },
            "required": ["server_name"],
        },
        handler=_list_mcp_tools,
        mutating=False,
        gated=False,
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
        logger.debug('cockpit usage summary failed', exc_info=True)
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


async def _list_threads(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tenant_introspection import list_threads_summary

    older_raw = tool_input.get("older_than_days")
    older_than_days = int(older_raw) if older_raw is not None else None
    scheduled_from = _parse_when(tool_input.get("scheduled_from"))
    scheduled_to = _parse_when(tool_input.get("scheduled_to"))
    tag_raw = tool_input.get("tag")
    if tag_raw is None and tool_input.get("tags") is not None:
        tag_raw = tool_input.get("tags")
    payload = await list_threads_summary(
        ctx.session,
        ctx.tenant_id,
        status=tool_input.get("status", "open"),
        channel=tool_input.get("channel"),
        older_than_days=older_than_days,
        limit=int(tool_input.get("limit") or 25),
        scheduled_from=scheduled_from,
        scheduled_to=scheduled_to,
        tag=tag_raw,
    )
    return payload


register_tool(
    ToolSpec(
        name="get_tenant_overview",
        description=(
            "Live tenant snapshot: agents, folders, enabled triggers (schedule + last run), "
            "open decisions (count + recent decisions[{id,title,path,signal_id}]), "
            "tasks/internal threads, connections/MCP servers, and usage totals. "
            "Call this before claiming you lack information about the tenant or a folder. "
            "There is no list_open_decisions tool — use this."
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
            "Use to answer what happened lately in the tenant or a folder."
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
            "This is the only thread list — do not invent list_open_internal_threads. "
            "Open internal threads: channel=internal (status defaults to open). "
            "Open tickets for a label (bug, feature, …): pass tag (the label name, or "
            "comma-separated / list). Prefer this over list_queue_items for "
            "'which bugs/features are open' — those are filed conversations, not folder "
            "queue rows. A lookup does not show cards. Call attach_items "
            "(type conversation) when you want those threads as cards, and do not "
            "repeat them as a numbered list. "
            "Not for workspace users or teams — use list_departments (and membership tools) instead. "
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
                "tag": {
                    "description": (
                        "Label name (e.g. bug), comma-separated names, "
                        "or a list. Matches ticket labels and other labels."
                    ),
                    "oneOf": [
                        {"type": "string"},
                        {"type": "array", "items": {"type": "string"}},
                    ],
                },
                "tags": {
                    "description": "Alias for tag (list of label names).",
                    "type": "array",
                    "items": {"type": "string"},
                },
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

# ── workforce introspection (agents / playbooks / triggers) ──────


_AVATAR_KEYS = (
    "avatar_kind",
    "avatar_icon",
    "avatar_color",
    "avatar_shape",
    "avatar_image_url",
)


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


async def _list_agents(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.models.agent import Agent

    # Same roster as GET /workforce/agents and the Agents page: company agents
    # only. The Bokito helper (acts_for_user) is not a teammate agent.
    stmt = select(Agent).where(
        Agent.tenant_id == ctx.tenant_id,
        Agent.acts_for_user.is_(False),
        Agent.kind == "company",
    )
    if tool_input.get("include_inactive") is not True:
        stmt = stmt.where(Agent.is_active.is_(True))
    rows = (
        await ctx.session.execute(stmt.order_by(Agent.name).limit(100))
    ).scalars().all()
    agents = [_serialize_agent_row(row) for row in rows]
    return {"agents": agents, "count": len(agents)}


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
    return _serialize_agent_row(row, detail=True)


async def _list_flows(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
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
    return {"flows": await list_workstreams(ctx.session, ctx.tenant_id, project_id=project_id)}


async def _get_flow(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
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
    except (HTTPException, AppError) as exc:
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


register_tool(
    ToolSpec(
        name="list_agents",
        description=(
            "List company AI agents on the Agents page (name, description, slug, "
            "role, autonomy, active flag, path, mention). This is the agent "
            "roster — humans are not included. You may appear in the list; the "
            "person chatting with you does not. Excludes the Bokito helper that "
            "acts for the signed-in user. A lookup does not show cards. Call "
            "attach_items (type agent) when you want agent cards on the reply. "
            "In prose chip one name with mention or [Name](/agents/{id}) "
            "from path — never a plain bold name. Pass include_inactive to also "
            "see paused agents."
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


async def _list_teams(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.teams import list_teams as list_team_rows, serialize_team

    rows = await list_team_rows(ctx.session, ctx.tenant_id)
    teams: list[dict[str, Any]] = []
    for row in rows:
        data = await serialize_team(ctx.session, row)
        name = str(data.get("name") or "Team")
        team_id = str(data["id"])
        data["mention"] = f"@[{name}](team:{team_id})"
        data["path"] = f"/team?team={team_id}"
        # Operators see Alle mensen / Alle agents; API name is All people / All agents.
        if data.get("kind") == "people":
            data["label_nl"] = "Alle mensen"
        elif data.get("kind") == "agents":
            data["label_nl"] = "Alle agents"
        teams.append(data)
    return {
        "departments": teams,
        "count": len(teams),
        "note": (
            "Departments (afdelingen): groups of people and agents. "
            "Not folders (mappen). Call list_folders to list or file into folders."
        ),
    }


register_tool(
    ToolSpec(
        name="list_departments",
        description=(
            "List departments (Afdelingen): groups of people and agents. Always "
            "includes the two system departments (kind=people / All people / "
            "Alle mensen, and kind=agents / All agents / Alle agents) plus custom "
            "departments such as Accounting or Support. These are not folders "
            "(Mappen). Never present this list as folders or mappen; to "
            "list or file places where work is stored, call list_folders. Returns "
            "mention chips @[Name](team:{id}). Use this for which departments "
            "exist — never list_threads, list_contacts, or list_folders. Do not "
            "say there are no departments when only the two system ones exist."
        ),
        category="agents",
        input_schema={"type": "object", "properties": {}},
        handler=_list_teams,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="get_agent",
        description=(
            "Read one agent by id or slug, including its description, purpose "
            "(system prompt), tool passport, path and mention. Does not show a "
            "card. Call attach_items (type agent) when you want one, and use "
            "mention or path for an inline chip in chat."
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
        name="list_flows",
        description=(
            "List flows (workstreams) with their step counts. Scoped to a "
            "folder when project_id is given or the run is folder-scoped."
        ),
        category="agents",
        input_schema={
            "type": "object",
            "properties": {"project_id": {"type": "string"}},
        },
        handler=_list_flows,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="get_flow",
        description="Read one flow (workstream) with its ordered steps.",
        category="agents",
        input_schema={
            "type": "object",
            "properties": {
                "playbook_id": {"type": "string"},
                "workstream_id": {"type": "string"},
            },
        },
        handler=_get_flow,
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


async def _review_lessons(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.knowledge_lessons import review_lessons

    raw = tool_input.get("section_ids") or []
    if isinstance(raw, str):
        raw = [raw]
    return await review_lessons(
        ctx.session,
        ctx.tenant_id,
        action=str(tool_input.get("action") or ""),
        section_ids=[str(item) for item in raw],
        actor_id=str(ctx.user_id or ""),
    )


register_tool(
    ToolSpec(
        name="review_lessons",
        description=(
            "Confirm, defer or discard concept lessons. "
            "action is promote, defer or discard. section_ids are lesson section ids."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["promote", "defer", "discard"]},
                "section_ids": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["action", "section_ids"],
        },
        handler=_review_lessons,
        mutating=True,
        gated=False,
    )
)
