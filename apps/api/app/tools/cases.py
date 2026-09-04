"""Operational case tools. Structural type/binding edits go through govern."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.tools.registry import ToolContext, ToolSpec, register_tool


def _uuid(raw: Any) -> UUID | None:
    if not raw:
        return None
    try:
        return UUID(str(raw))
    except ValueError:
        return None


async def _list_case_types(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.cases import list_case_types, serialize_case_type

    rows = await list_case_types(ctx.session, ctx.tenant_id)
    audience = ctx.audience
    items = []
    for row in rows:
        if not row.enabled:
            continue
        if audience == "customer" and row.audience == "internal":
            continue
        items.append(serialize_case_type(row))
    return {"items": items}


async def _list_cases(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.cases import list_cases, serialize_case

    signal_id = _uuid(tool_input.get("signal_id")) or ctx.signal_id
    rows = await list_cases(ctx.session, ctx.tenant_id, signal_id=signal_id)
    return {"items": [serialize_case(case, case_type) for case, case_type in rows]}


async def _create_case(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.cases import create_case, get_case_type, list_case_types

    signal_id = _uuid(tool_input.get("signal_id")) or ctx.signal_id
    if signal_id is None:
        return {"error": "signal_id is required"}
    type_id = _uuid(tool_input.get("case_type_id"))
    slug = str(tool_input.get("case_type") or tool_input.get("slug") or "").strip()
    if type_id is None and slug:
        types = await list_case_types(ctx.session, ctx.tenant_id)
        match = next((row for row in types if row.slug == slug), None)
        if match:
            type_id = match.id
    if type_id is None:
        return {"error": "case_type_id or case_type slug is required"}
    certainty = tool_input.get("certainty")
    try:
        score = int(certainty) if certainty is not None else None
    except (TypeError, ValueError):
        score = None
    try:
        case_type = await get_case_type(ctx.session, ctx.tenant_id, type_id)
    except HTTPException as exc:
        return {"error": exc.detail}
    if ctx.audience == "customer" and case_type.audience == "internal":
        return {"error": "This case type is not available here"}
    actor = "agent" if ctx.agent else "operator"
    try:
        return await create_case(
            ctx.session,
            ctx.tenant_id,
            case_type_id=type_id,
            signal_id=signal_id,
            title=str(tool_input.get("title") or ""),
            summary=str(tool_input.get("summary") or ""),
            payload=tool_input.get("payload") if isinstance(tool_input.get("payload"), dict) else {},
            certainty=score,
            project_id=_uuid(tool_input.get("project_id")) or ctx.project_id,
            actor=actor,
            created_by_type="agent" if ctx.agent else "user",
            created_by_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
            user_id=ctx.user_id,
            agent_id=ctx.agent.id if ctx.agent else None,
        )
    except HTTPException as exc:
        return {"error": exc.detail}


async def _update_case(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.cases import get_case, serialize_case, update_case

    case_id = _uuid(tool_input.get("case_id"))
    if case_id is None:
        return {"error": "case_id is required"}
    try:
        case = await update_case(ctx.session, ctx.tenant_id, case_id, tool_input)
        case, case_type = await get_case(ctx.session, ctx.tenant_id, case.id)
    except HTTPException as exc:
        return {"error": exc.detail}
    return serialize_case(case, case_type)


async def _link_case(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.cases import get_case, link_case, serialize_case

    case_id = _uuid(tool_input.get("case_id"))
    target_id = _uuid(tool_input.get("target_id"))
    target_kind = str(tool_input.get("target_kind") or "")
    if case_id is None or target_id is None or not target_kind:
        return {"error": "case_id, target_kind and target_id are required"}
    try:
        case = await link_case(
            ctx.session,
            ctx.tenant_id,
            case_id,
            target_kind=target_kind,
            target_id=target_id,
            auto_start_run=bool(tool_input.get("auto_start_run")),
            created_by_type="agent" if ctx.agent else "user",
            created_by_id=str(ctx.agent.id if ctx.agent else ctx.user_id or ""),
        )
        case, case_type = await get_case(ctx.session, ctx.tenant_id, case.id)
    except HTTPException as exc:
        return {"error": exc.detail}
    return serialize_case(case, case_type)


register_tool(
    ToolSpec(
        name="list_case_types",
        description="List intake types this workspace can open on a conversation.",
        category="cases",
        input_schema={"type": "object", "properties": {}},
        handler=_list_case_types,
        mutating=False,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="list_cases",
        description="List cases on a conversation (defaults to the current thread).",
        category="cases",
        input_schema={
            "type": "object",
            "properties": {"signal_id": {"type": "string"}},
        },
        handler=_list_cases,
        mutating=False,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="create_case",
        description=(
            "Open a typed case on this conversation. Use one type per intent; "
            "never dump multiple issues into one case. The type's mode and "
            "certainty decide whether it opens, asks the visitor, or asks the team."
        ),
        category="cases",
        input_schema={
            "type": "object",
            "properties": {
                "case_type_id": {"type": "string"},
                "case_type": {"type": "string", "description": "Type slug, e.g. bug_report"},
                "signal_id": {"type": "string"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "certainty": {"type": "integer", "description": "0-10 how sure you are of the type"},
                "project_id": {"type": "string"},
                "payload": {"type": "object"},
            },
        },
        handler=_create_case,
        mutating=True,
        gated=True,
        handles_ask=True,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="update_case",
        description="Update a case title, summary, or status.",
        category="cases",
        input_schema={
            "type": "object",
            "properties": {
                "case_id": {"type": "string"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "status": {"type": "string"},
            },
            "required": ["case_id"],
        },
        handler=_update_case,
        mutating=True,
        gated=True,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="link_case",
        description="Link a case to a workstream or project, optionally starting a run.",
        category="cases",
        input_schema={
            "type": "object",
            "properties": {
                "case_id": {"type": "string"},
                "target_kind": {"type": "string", "enum": ["workstream", "project"]},
                "target_id": {"type": "string"},
                "auto_start_run": {"type": "boolean"},
            },
            "required": ["case_id", "target_kind", "target_id"],
        },
        handler=_link_case,
        mutating=True,
        gated=True,
        audience="operator",
    )
)
