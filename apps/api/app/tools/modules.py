"""Module discovery tools: list what exists and recommend a setup."""

from __future__ import annotations

from typing import Any

from app.modules.catalog import (
    MODULES,
    get_module,
    module_is_on,
    serialize_modules_for_tenant,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _list_modules(ctx: ToolContext, _tool_input: dict[str, Any]) -> dict[str, Any]:
    rows = await serialize_modules_for_tenant(ctx.session, ctx.tenant_id)
    return {"modules": rows}


async def _recommend_module(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.builtin import _create_decision_request

    slug = str(tool_input.get("slug") or "").strip()
    spec = get_module(slug)
    if spec is None:
        known = ", ".join(m.slug for m in MODULES)
        return {"error": f"Unknown module '{slug}'. Known: {known}."}
    if spec.status == "coming_soon":
        return {
            "ok": False,
            "code": "coming_soon",
            "message": (
                f"{spec.name} is prepared but not connectable yet. "
                f"Tell the operator what will be possible later: {spec.capability_summary}"
            ),
            "setup_path": spec.setup_path,
        }

    provider = str(tool_input.get("provider") or "").strip()
    reason = str(tool_input.get("reason") or "").strip()
    payload: dict[str, Any] = {"module": spec.slug}
    if provider:
        payload["provider"] = provider
    already_on = await module_is_on(ctx.session, ctx.tenant_id, spec.slug)
    if already_on:
        title = f"Connect a package for {spec.name}?"
        approve = {
            "id": "connect",
            "label": "Connect a package",
            "action_type": "setup_integration",
            "payload": payload,
        }
    else:
        title = f"Turn on {spec.name}?"
        approve = {
            "id": "enable",
            "label": "Turn on",
            "action_type": "enable_module",
            "payload": payload,
        }
    summary = reason or f"Use when {spec.needs_when}."
    if provider:
        summary = f"{summary} Suggested package: {provider}."
    return await _create_decision_request(
        ctx,
        {
            "title": title,
            "summary": summary,
            "signal_id": tool_input.get("signal_id") or (str(ctx.signal_id) if ctx.signal_id else None),
            "options": [
                approve,
                {"id": "later", "label": "Later", "action_type": "defer"},
            ],
        },
    )


async def _list_module_connections(
    ctx: ToolContext, tool_input: dict[str, Any]
) -> dict[str, Any]:
    from app.services.module_connections import list_module_connections

    slug = str(tool_input.get("slug") or "").strip()
    if get_module(slug) is None:
        return {"error": f"Unknown module '{slug}'."}
    return await list_module_connections(ctx.session, ctx.tenant_id, slug)


async def _set_module_default_connection(
    ctx: ToolContext, tool_input: dict[str, Any]
) -> dict[str, Any]:
    from app.services.module_connections import set_module_defaults

    slug = str(tool_input.get("slug") or "").strip()
    if get_module(slug) is None:
        return {"error": f"Unknown module '{slug}'."}
    connection_id = str(tool_input.get("connection_id") or "").strip()
    if not connection_id:
        return {"error": "connection_id is required."}
    company_id = tool_input.get("company_id")
    prefs = await set_module_defaults(
        ctx.session,
        ctx.tenant_id,
        slug,
        default_connection_id=connection_id,
        default_company_id=str(company_id) if company_id is not None else None,
    )
    return {"ok": True, "prefs": prefs}


async def _list_module_sources(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.module_sources import ensure_platform_seeds, list_sources

    slug = str(tool_input.get("slug") or "").strip()
    if get_module(slug) is None:
        return {"error": f"Unknown module '{slug}'."}
    if not await module_is_on(ctx.session, ctx.tenant_id, slug):
        return {"error": f"Module '{slug}' is off."}
    await ensure_platform_seeds(ctx.session, ctx.tenant_id, slug)
    return {"sources": await list_sources(ctx.session, ctx.tenant_id, slug)}


async def _search_module_sources(
    ctx: ToolContext, tool_input: dict[str, Any]
) -> dict[str, Any]:
    from app.services.module_sources import search_module_sources

    slug = str(tool_input.get("slug") or "").strip()
    query = str(tool_input.get("query") or "").strip()
    if get_module(slug) is None:
        return {"error": f"Unknown module '{slug}'."}
    if not query:
        return {"error": "query is required."}
    if not await module_is_on(ctx.session, ctx.tenant_id, slug):
        return {"error": f"Module '{slug}' is off."}
    hits = await search_module_sources(ctx.session, ctx.tenant_id, slug, query)
    return {"hits": hits}


async def _propose_module_source(
    ctx: ToolContext, tool_input: dict[str, Any]
) -> dict[str, Any]:
    from app.tools.builtin import _create_decision_request

    slug = str(tool_input.get("slug") or "").strip()
    url = str(tool_input.get("url") or "").strip()
    title = str(tool_input.get("title") or "").strip()
    reason = str(tool_input.get("reason") or "").strip()
    spec = get_module(slug)
    if spec is None:
        return {"error": f"Unknown module '{slug}'."}
    if not url.startswith("http://") and not url.startswith("https://"):
        return {"error": "url must start with http:// or https://"}
    return await _create_decision_request(
        ctx,
        {
            "title": f"Add source to {spec.name}?",
            "summary": reason or f"Index {title or url} for the {spec.name} module.",
            "signal_id": tool_input.get("signal_id")
            or (str(ctx.signal_id) if ctx.signal_id else None),
            "options": [
                {
                    "id": "add",
                    "label": "Add source",
                    "action_type": "add_module_source",
                    "payload": {
                        "module": slug,
                        "url": url,
                        "title": title or url,
                    },
                },
                {"id": "later", "label": "Later", "action_type": "defer"},
            ],
        },
    )


register_tool(
    ToolSpec(
        name="list_modules",
        description=(
            "List business modules (accounting, banking, investing, documents) "
            "with tenant status, when to use each, and setup steps. "
            "Call this when work might need bookkeeping, banking, or file storage."
        ),
        category="integrations",
        input_schema={"type": "object", "properties": {}},
        handler=_list_modules,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="recommend_module",
        description=(
            "Propose turning on a business module. Creates a decision card that "
            "enables the module for this workspace. Use after list_modules when "
            "invoices, VAT, ledgers, or similar work comes up and the module is "
            "off. Do not recommend coming_soon modules as connectable."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "slug": {"type": "string", "description": "Module slug, e.g. accounting."},
                "reason": {"type": "string"},
                "provider": {
                    "type": "string",
                    "description": "Optional package slug if the user already named one.",
                },
                "signal_id": {"type": "string"},
            },
            "required": ["slug", "reason"],
        },
        handler=_recommend_module,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_module_connections",
        description=(
            "List registrations (connections) for a module, including defaults "
            "and administrations/companies when available."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {"slug": {"type": "string"}},
            "required": ["slug"],
        },
        handler=_list_module_connections,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="set_module_default_connection",
        description=(
            "Set which registration agents should use by default for a module. "
            "Optionally set a default company/administration for that registration."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "slug": {"type": "string"},
                "connection_id": {"type": "string"},
                "company_id": {"type": "string"},
            },
            "required": ["slug", "connection_id"],
        },
        handler=_set_module_default_connection,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_module_sources",
        description=(
            "List knowledge sources for a module (platform seeds and tenant URLs) "
            "with sync status. Module must be on."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {"slug": {"type": "string"}},
            "required": ["slug"],
        },
        handler=_list_module_sources,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="search_module_sources",
        description=(
            "Search indexed module sources (e.g. accounting regulations). "
            "Module must be on."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "slug": {"type": "string"},
                "query": {"type": "string"},
            },
            "required": ["slug", "query"],
        },
        handler=_search_module_sources,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="propose_module_source",
        description=(
            "Propose adding a URL as a module knowledge source. Creates a "
            "decision card the operator approves before indexing."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "slug": {"type": "string"},
                "url": {"type": "string"},
                "title": {"type": "string"},
                "reason": {"type": "string"},
                "signal_id": {"type": "string"},
            },
            "required": ["slug", "url", "reason"],
        },
        handler=_propose_module_source,
        gated=False,
    )
)
