"""Ticket tools: file a label with a flow on a conversation, move it, accept or dismiss it.

Structural edits (which hashtags have which flow) go through govern.
A label with a flow is a hashtag whose ``SignalTag.workstream_id`` is set.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException

from app.exceptions import AppError
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
    from app.services.folders import load_catalog, serialize_folders_for_tag
    from app.services.tickets import (
        intake_fields,
        list_categories,
        serialize_category,
        workstream_stages,
    )

    catalog = await load_catalog(ctx.session, ctx.tenant_id)
    items = []
    for row in await list_categories(ctx.session, ctx.tenant_id):
        item = serialize_category(row)
        item["folders"] = [
            {"id": entry["id"], "path": entry["path"]}
            for entry in serialize_folders_for_tag(catalog, row.id)
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
    except (HTTPException, AppError) as exc:
        return {"error": exc.detail}
    from app.services.department_domain import department_of_signal
    from app.services.department_visibility import department_visible
    from app.tools.workspace_read import mark_responsibility

    if ctx.agent is not None and not await department_visible(
        ctx.session, ctx.tenant_id, await department_of_signal(ctx.session, signal), kind="agent", member_id=ctx.agent.id
    ):
        return {"error": "This ticket sits in a shielded department you are not part of."}
    ticket = await ticket_payload(ctx.session, signal)
    marked = [{"id": str(signal.id)}]
    await mark_responsibility(ctx, marked)
    ticket.update({k: v for k, v in marked[0].items() if k != "id"})
    return {"ticket": ticket}


async def _file_ticket(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tickets import file_ticket, find_category

    signal_id = _uuid(tool_input.get("signal_id")) or ctx.signal_id
    if signal_id is None:
        return {"error": "signal_id is required"}
    ref = str(tool_input.get("category") or tool_input.get("tag_id") or "").strip()
    tag = await find_category(ctx.session, ctx.tenant_id, ref)
    if tag is None:
        return {"error": "Unknown label with a flow. Use list_categories for the labels that start a ticket flow."}
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
            stage_key=str(tool_input.get("stage_key") or "") or None,
            reason=str(tool_input.get("reason") or ""),
        )
    except (HTTPException, AppError) as exc:
        return {"error": exc.detail}


async def _update_ticket(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.tickets import update_ticket

    signal_id = _uuid(tool_input.get("signal_id")) or ctx.signal_id
    if signal_id is None:
        return {"error": "signal_id is required"}
    patch = {
        k: tool_input[k]
        for k in (
            "status",
            "stage_key",
            "project_id",
            "fields",
            "due_at",
            "due_source",
            "due_basis",
            "checklist",
            "certainty",
            "reason",
            "message_id",
        )
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
    except (HTTPException, AppError) as exc:
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
            "List labels with a flow (also called categories): labels that start a "
            "ticket flow, with the folders that carry each label. "
            "Labels without a flow are not listed here; use set_thread_tags for those."
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
            "Show a conversation's ticket: label with a flow, stage, flow and folder path "
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
            "File a label with a flow on this conversation, making it a ticket in that "
            "label's flow. A conversation has one label with a flow; when it already has "
            "another one, split the conversation instead (do not stack). The folder "
            "follows from the conversation's labels (its own, the one with a flow, and "
            "its contact's); add the missing label with set_thread_tags rather than "
            "guessing a folder. Pass optional "
            "intake fields from list_categories (first open stage). Same path as the Hashtags picker. "
            "stage_key suggests a later stage; the flow decides whether that moves the ticket, "
            "becomes a proposal for a person, or is dropped."
        ),
        category="tickets",
        input_schema={
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Label name of a flow (e.g. klacht) or id, without a leading #",
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
                    "description": "0-10 how sure you are of the label",
                },
                "stage_key": {
                    "type": "string",
                    "description": "Optional: the stage the work is already in, when it is past the first stage",
                },
                "reason": {"type": "string", "description": "Why that stage, in one sentence"},
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
            "required fields, pass them in fields in the same call or the move is rejected. "
            "A stage move follows the flow's stage-entry policy: it may move, become a "
            "proposal a person confirms (pass certainty and reason), or be refused. "
            "A deadline you set (due_at) is always a proposal. Checklist items you tick "
            "(checklist: {item_key: done}) stay proposed until a person confirms them; "
            "pass message_id when a message or attachment is the evidence."
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
                "certainty": {"type": "integer", "description": "0-10 how sure you are of the stage"},
                "reason": {"type": "string", "description": "Why this stage or deadline, in one sentence"},
                "due_at": {"type": ["string", "null"], "description": "Deadline, ISO date (YYYY-MM-DD) or date-time"},
                "due_source": {"type": "string", "enum": ["statutory", "requested", "agreed", "manual"]},
                "due_basis": {
                    "type": "string",
                    "description": "Where the date comes from, e.g. 'reminder letter of 12 Oct'",
                },
                "checklist": {
                    "type": "object",
                    "description": "Checklist item keys (from get_ticket) mapped to done or open",
                    "additionalProperties": {"type": "string", "enum": ["done", "open"]},
                },
                "message_id": {"type": "string", "description": "Message that is the evidence for ticked items"},
            },
        },
        handler=_update_ticket,
        mutating=True,
        gated=True,
        audience="both",
    )
)
