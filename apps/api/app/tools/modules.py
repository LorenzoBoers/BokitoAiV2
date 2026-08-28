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
