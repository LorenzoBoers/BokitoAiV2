"""Ticket tools: file an action tag on a conversation, move it, accept or dismiss it.

Structural edits (which hashtags have which flow) go through govern.
An action tag is a hashtag with a playbook (``SignalTag.workstream_id``).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.tools.registry import ToolContext, ToolSpec, register_tool

_NO_PROJECT = ("", "none", "no_project", "null")


def _uuid(raw: Any) -> UUID | None:
    if not raw:
        return None
    try:
        return UUID(str(raw))
    except ValueError:
        return None


def _actor(ctx: ToolContext) -> tuple[str, str]:
    if ctx.agent:
        return "agent", str(ctx.agent.id)
    return "user", str(ctx.user_id or "")


async def _list_categories(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.models.orchestra import Workstream
    from app.services.folders import load_tree
    from app.services.tickets import (
        intake_fields,
        list_categories,
        serialize_category,
        workstream_stages,
    )

    tree = await load_tree(ctx.session, ctx.tenant_id)
    items = []
    for row in await list_categories(ctx.session, ctx.tenant_id):
        item = serialize_category(row)
        item["folders"] = [
            {"id": str(node.id), "path": tree.static_path(node.id).label}
            for node in tree.nodes.values()
            if node.tag_id == row.id
        ]
        ws = await ctx.session.get(Workstream, row.workstream_id) if row.workstream_id else None
        item["intake_fields"] = intake_fields(workstream_stages(ws))
        items.append(item)
    return {"items": items}


async def _get_ticket(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tickets import _signal, ticket_payload

    signal_id = _uuid(tool_input.get("signal_id")) or ctx.signal_id
    if signal_id is None:
        return {"error": "signal_id is required"}
    try:
        signal = await _signal(ctx.session, ctx.tenant_id, signal_id)
    except HTTPException as exc:
        return {"error": exc.detail}
    return {"ticket": await ticket_payload(ctx.session, signal)}


async def _file_ticket(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tickets import file_ticket, find_category

    signal_id = _uuid(tool_input.get("signal_id")) or ctx.signal_id
    if signal_id is None:
        return {"error": "signal_id is required"}
    ref = str(tool_input.get("category") or tool_input.get("tag_id") or "").strip()
    tag = await find_category(ctx.session, ctx.tenant_id, ref)
    if tag is None:
        return {"error": "Unknown action tag. Use list_categories for the hashtags that start a ticket flow."}
    raw_project = tool_input.get("folder_id", tool_input.get("project_id"))
    project_id = None
    if str(raw_project or "").strip().lower() not in _NO_PROJECT:
        project_id = _uuid(raw_project)
        if project_id is None:
            return {"error": "folder_id must be a folder id"}
    raw_fields = tool_input.get("fields")
    fields = raw_fields if isinstance(raw_fields, dict) else None
    certainty = tool_input.get("certainty")
    try:
        score = int(certainty) if certainty is not None else None
    except (TypeError, ValueError):
        score = None
    actor_type, actor_id = _actor(ctx)
    try:
        return await file_ticket(
            ctx.session,
            ctx.tenant_id,
            signal_id=signal_id,
            tag_id=tag.id,
            project_id=project_id,
            fields=fields,
            summary=str(tool_input.get("summary") or ""),
            certainty=score,
            actor="agent" if ctx.agent else "operator",
            created_by_type=actor_type,
            created_by_id=actor_id,
            user_id=ctx.user_id,
            agent_id=ctx.agent.id if ctx.agent else None,
        )
    except HTTPException as exc:
        return {"error": exc.detail}


async def _update_ticket(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tickets import update_ticket

    signal_id = _uuid(tool_input.get("signal_id")) or ctx.signal_id
    if signal_id is None:
        return {"error": "signal_id is required"}
    patch = {
        k: tool_input[k]
        for k in ("status", "stage_key", "project_id", "fields")
        if k in tool_input
    }
    if "folder_id" in tool_input:
        patch["project_id"] = tool_input["folder_id"]
    if "project_id" in patch and str(patch["project_id"] or "").strip().lower() in _NO_PROJECT:
        patch["project_id"] = None
    actor_type, actor_id = _actor(ctx)
    try:
        ticket = await update_ticket(
            ctx.session, ctx.tenant_id, signal_id, patch, actor_type=actor_type, actor_id=actor_id
        )
    except HTTPException as exc:
        detail = exc.detail
        if isinstance(detail, dict):
            return {"error": detail.get("message") or "Could not update the ticket", **detail}
        return {"error": detail}
    if ticket is None:
        return {"ok": True, "removed": True}
    return {"ticket": ticket}


register_tool(
    ToolSpec(
        name="list_categories",
        description=(
            "List action tags (also called categories): hashtags that start a ticket "
            "flow, with the folders that carry each tag. "
            "Free hashtags without a flow are not listed here; use set_thread_tags for those."
        ),
        category="tickets",
        input_schema={"type": "object", "properties": {}},
        handler=_list_categories,
        mutating=False,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="get_ticket",
        description=(
            "Show a conversation's ticket: action tag, stage, flow and folder path "
            "(defaults to the current thread)."
        ),
        category="tickets",
        input_schema={"type": "object", "properties": {"signal_id": {"type": "string"}}},
        handler=_get_ticket,
        mutating=False,
        gated=False,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="file_ticket",
        description=(
            "File an action tag on this conversation, making it a ticket in that tag's "
            "flow. A conversation has one action tag; when it already has another one, "
            "split the conversation instead (do not stack). The folder follows from the "
            "conversation's tags (its own, the action tag, and its contact's); add the "
            "missing tag with set_thread_tags rather than guessing a folder. Pass optional "
            "intake fields from list_categories (first open stage). Same path as the Hashtags picker."
        ),
        category="tickets",
        input_schema={
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Action-tag hashtag name (e.g. klacht) or id",
                },
                "signal_id": {"type": "string"},
                "folder_id": {
                    "type": ["string", "null"],
                    "description": "Optional: file the conversation in this folder first (adds the folder's tags)",
                },
                "fields": {
                    "type": "object",
                    "description": "Intake field values keyed by field key from the first open stage",
                    "additionalProperties": {"type": "string"},
                },
                "summary": {"type": "string"},
                "certainty": {
                    "type": "integer",
                    "description": "0-10 how sure you are of the action tag",
                },
            },
            "required": ["category"],
        },
        handler=_file_ticket,
        mutating=True,
        gated=True,
        handles_ask=True,
        audience="both",
    )
)

register_tool(
    ToolSpec(
        name="update_ticket",
        description=(
            "Move a ticket to a stage (stage_key from its flow), accept a proposed "
            "ticket (status open), dismiss it (status dismissed), or file it in a folder "
            "(folder_id; null takes it out of its folder). When the target stage has "
            "required fields, pass them in fields in the same call or the move is rejected."
        ),
        category="tickets",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {"type": "string"},
                "stage_key": {"type": "string"},
                "status": {"type": "string", "enum": ["open", "waiting", "done", "dismissed"]},
                "folder_id": {"type": ["string", "null"]},
                "fields": {
                    "type": "object",
                    "description": "Field values for the target stage, keyed by field key",
                    "additionalProperties": {"type": "string"},
                },
            },
        },
        handler=_update_ticket,
        mutating=True,
        gated=True,
        audience="both",
    )
)
