"""Label tools and filing labels on conversations and contacts."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.tools._common import (
    _get_tenant,
    _resolve_messaging_signal,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _set_thread_tags(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Add or remove free labels on this conversation.

    Adds only names that already exist; new labels come from a label plan or
    create_tag. Removes only
    free labels linked on this conversation — never an label, never a
    label that arrives only through the contact or company, and never a
    catalog delete.
    """
    from datetime import datetime

    from app.gateway.publish import publish_thread_update
    from app.models.signal import SignalEvent
    from app.services.signal_tags import allowed_tag_names, normalize_tag

    signal, err = await _resolve_messaging_signal(ctx, tool_input)
    if signal is None:
        return {"error": err or "Signal not found"}

    requested = tool_input.get("tags") or []
    remove_requested = tool_input.get("remove") or []
    if not isinstance(requested, list) or not isinstance(remove_requested, list):
        return {"error": "tags and remove must be lists of strings"}
    if not requested and not remove_requested:
        return {"error": "tags or remove must be a non-empty list of strings"}

    catalog = set(await allowed_tag_names(ctx.session, ctx.tenant_id))
    allowed: list[str] = []
    rejected: list[str] = []
    for raw in requested:
        name = normalize_tag(raw) if isinstance(raw, str) else ""
        if not name:
            continue
        (allowed if name in catalog else rejected).append(name)
    if requested and not allowed and not remove_requested:
        return {
            "error": (
                "None of the requested labels exist. Attach an existing label from "
                "the catalog, or propose new ones with propose_label_plan."
            ),
            "rejected": rejected,
            "catalog": sorted(catalog)[:30],
        }

    from app.models.signal import SignalTag
    from app.services.folders import inherited_tag_names
    from app.services.signal_tags import (
        add_signal_tag_rows,
        remove_signal_tag_ids,
        signal_tag_names,
    )

    actor_type = "agent" if ctx.agent else "user"
    actor_id = str(ctx.agent.id if ctx.agent else ctx.user_id or "")
    added: list[str] = []
    replaced: list[str] = []
    if allowed:
        rows_by_name = {
            row.name: row
            for row in (
                await ctx.session.execute(
                    select(SignalTag).where(
                        SignalTag.tenant_id == ctx.tenant_id,
                        SignalTag.name.in_(allowed),
                        SignalTag.workstream_id.is_(None),
                    )
                )
            ).scalars()
        }
        outcome = await add_signal_tag_rows(
            ctx.session,
            ctx.tenant_id,
            signal.id,
            [rows_by_name[n] for n in allowed if n in rows_by_name],
            replace_exclusive=False,
            actor_type=actor_type,
            actor_id=actor_id,
        )
        added = outcome["added"]
        replaced = outcome.get("replaced") or []

    own = set(await signal_tag_names(ctx.session, signal.id))
    inherited = set(await inherited_tag_names(ctx.session, signal))
    action_name = ""
    if signal.ticket_tag_id:
        action = await ctx.session.get(SignalTag, signal.ticket_tag_id)
        action_name = action.name if action is not None else ""
    remove_names: list[str] = []
    refused: list[dict[str, str]] = []
    for raw in remove_requested:
        name = normalize_tag(raw) if isinstance(raw, str) else ""
        if not name:
            continue
        if action_name and name == action_name:
            refused.append({"name": name, "reason": "action_tag"})
            continue
        if name not in own and name in inherited:
            refused.append({"name": name, "reason": "inherited"})
            continue
        if name not in own:
            refused.append({"name": name, "reason": "not_on_conversation"})
            continue
        remove_names.append(name)
    removed: list[str] = []
    if remove_names:
        rows = list(
            (
                await ctx.session.execute(
                    select(SignalTag).where(
                        SignalTag.tenant_id == ctx.tenant_id,
                        SignalTag.name.in_(remove_names),
                    )
                )
            ).scalars()
        )
        by_name = {row.name: row for row in rows}
        ids = []
        for name in remove_names:
            row = by_name.get(name)
            if row is None or row.workstream_id is not None:
                refused.append({"name": name, "reason": "action_tag" if row else "not_on_conversation"})
                continue
            ids.append(row.id)
            removed.append(name)
        if ids:
            await remove_signal_tag_ids(
                ctx.session,
                ctx.tenant_id,
                signal.id,
                ids,
                user_id=ctx.user_id,
                actor_type=actor_type,
                actor_id=actor_id,
            )
    tags = await signal_tag_names(ctx.session, signal.id)
    await ctx.session.refresh(signal)
    if added or replaced or removed:
        signal.updated_at = datetime.utcnow()
        ctx.session.add(signal)
        payload: dict[str, Any] = {
            "tags": tags,
            "tags_added": added,
            "tags_removed": removed or replaced,
            "via": "set_thread_tags",
        }
        if ctx.agent:
            payload["agent_id"] = str(ctx.agent.id)
            payload["agent_name"] = ctx.agent.name
        if ctx.run_id:
            payload["run_id"] = str(ctx.run_id)
        ctx.session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=ctx.tenant_id,
                event_type="thread_updated",
                actor_type=actor_type,
                actor_id=actor_id,
                payload_json=json.dumps(payload),
            )
        )
        await ctx.session.flush()
        await publish_thread_update(signal, tags=tags)
    return {
        "ok": True,
        "signal_id": str(signal.id),
        "added": added,
        "removed": removed,
        "tags": tags,
        "rejected": rejected,
        "refused": refused,
        "folder_id": str(signal.project_id) if signal.project_id else None,
    }


register_tool(
    ToolSpec(
        name="set_thread_tags",
        description=(
            "Add or remove free labels on a conversation. Omit signal_id to "
            "use the current thread — never invent a uuid. tags adds existing "
            "labels from the catalog only; propose new ones with "
            "propose_label_plan. remove unlinks a free label that is already on this conversation. "
            "It does not delete the label from the workspace, and it refuses "
            "an label and a label that only comes from the contact or "
            "company. Use file_ticket for an label. If a folder does not "
            "fit, remove its label. If the tool returns an error, fix the "
            "call; do not claim the label changed."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "signal_id": {
                    "type": "string",
                    "description": "Conversation id. Omit to use the current thread.",
                },
                "tags": {"type": "array", "items": {"type": "string"}},
                "remove": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Free labels to take off this conversation.",
                },
            },
            "required": [],
        },
        handler=_set_thread_tags,
        gated=False,
        audience="both",
        display_name="Added labels",
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
    from app.services.signal_tags import registry_with_counts

    catalog = {row["id"]: row for row in await registry_with_counts(ctx.session, ctx.tenant_id)}
    for tag in tags:
        extra = catalog.get(tag["id"]) or {}
        tag["folders"] = extra.get("folders") or []
        tag["path"] = " | ".join(folder.get("path") or folder.get("name") or "" for folder in tag["folders"])
    return {"tags": tags, "count": len(tags)}


async def _delete_tag(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from sqlalchemy import func

    from app.models.project import Project, ProjectTagLink
    from app.models.signal import SignalTag
    from app.services.signal_tags import delete_tag
    from app.services.trash import alive

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
    folder_rows = list(
        (
            await ctx.session.execute(
                select(Project.id, Project.name, Project.slug)
                .join(ProjectTagLink, ProjectTagLink.project_id == Project.id)
                .where(
                    Project.tenant_id == ctx.tenant_id,
                    ProjectTagLink.tag_id == tag_id,
                    alive(Project),
                )
                .distinct()
            )
        ).all()
    )
    if folder_rows:
        folders = [
            {"id": str(fid), "name": fname, "slug": slug or ""}
            for fid, fname, slug in folder_rows
        ]
        return {
            "error": "tag_defines_folder",
            "message": (
                f"#{tag_name} is part of {len(folders)} folder filterset"
                f"{'s' if len(folders) != 1 else ''}. "
                "Remove those folders with delete_folder first; do not delete_tag "
                "to remove a folder."
            ),
            "folders": folders,
            "hint": (
                "Call delete_folder with each folder id from list_folders. "
                "Only delete_tag when the tag is no longer in any folder."
            ),
        }
    try:
        await delete_tag(ctx.session, ctx.tenant_id, tag_id, commit=False)
    except ValueError as exc:
        return {
            "error": "blocked",
            "message": str(exc),
            "hint": "Call delete_folder on the listed folders, then retry delete_tag.",
        }
    return {"ok": True, "deleted": True, "id": str(tag_id), "name": tag_name}


register_tool(
    ToolSpec(
        name="list_tags",
        description=(
            "List workspace labels, including which ones have a flow (those start a ticket). "
            "Color exists only while that flow is attached. "
            "Use #name in chat for inline chips, or attach_items with type tag. "
            "Returns id, name, kind (tag|action_tag), folders, and markup. "
            "Never call a label an label or label."
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
            "Permanently delete a workspace tag (free tag or label) and unlink "
            "it from every conversation. Refuses when the tag is still part of a "
            "folder filterset — call delete_folder on those folders first. Prefer "
            "propose_action with action=delete_tag and payload {name} or {id} so "
            "the operator approves first. Do not invent soft Yes/No options without "
            "this action. Do not use this to remove a folder."
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

    from app.services.label_policy import check_new_label

    name = normalize_tag(str(tool_input.get("name") or ""))
    if not name:
        return {"error": "missing_name", "message": "Pass the hashtag name without #."}
    refusal = await check_new_label(
        ctx.session, ctx.tenant_id, name, str(tool_input.get("description") or "")
    )
    if refusal:
        return refusal
    row = await create_tag(
        ctx.session,
        ctx.tenant_id,
        name,
        description=str(tool_input.get("description") or ""),
        show_in_nav=bool(tool_input.get("show_in_nav")),
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
        from app.services.label_policy import check_new_label

        description = tool_input.get("description")
        refusal = await check_new_label(
            ctx.session,
            ctx.tenant_id,
            str(tool_input["new_name"]),
            str(description if description is not None else row.description or ""),
            renaming=row.name,
        )
        if refusal:
            return refusal
        fields["name"] = str(tool_input["new_name"])
    if "description" in tool_input and tool_input["description"] is not None:
        fields["description"] = str(tool_input["description"])
    for key in ("show_in_nav", "ai_auto_tag"):
        if key in tool_input and tool_input[key] is not None:
            fields[key] = bool(tool_input[key])
    if not fields:
        return {"error": "nothing_to_change", "message": "Pass new_name, description, show_in_nav or ai_auto_tag."}
    try:
        row = await update_tag(ctx.session, ctx.tenant_id, row.id, commit=False, **fields)
    except ValueError as exc:
        return {"error": "invalid", "message": str(exc)}
    return {"ok": True, "tag": serialize_tag(row)}


async def _merge_labels(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.signal_tags import merge_tags, normalize_tag, serialize_tag

    source_name = normalize_tag(str(tool_input.get("name") or ""))
    into_name = normalize_tag(str(tool_input.get("into") or ""))
    if not source_name or not into_name:
        return {"error": "missing_name", "message": "Pass name (the label to remove) and into (the label to keep)."}
    source, error = await _find_tag_row(ctx, {"name": source_name}, "tag_id", "id")
    if error:
        return error
    target, error = await _find_tag_row(ctx, {"name": into_name}, "tag_id", "id")
    if error:
        return {"error": "not_found", "message": f"#{into_name} is not a label. Merge into one that already exists."}
    try:
        row = await merge_tags(ctx.session, ctx.tenant_id, source.id, target.id, commit=False)
    except ValueError as exc:
        return {"error": "invalid", "message": str(exc)}
    return {
        "ok": True,
        "removed": source_name,
        "tag": serialize_tag(row),
        "message": f"#{source_name} is now #{row.name}. Conversations, contacts, companies, folders and rules moved.",
    }


register_tool(
    ToolSpec(
        name="merge_labels",
        description=(
            "Merge one free label into another that already exists. Every conversation, "
            "contact, company, calendar, folder and inbox rule that used the spare label "
            "moves to the one you keep, and the spare label is removed. Pass name for "
            "the label to remove and into for the label to keep. Do not use this on a "
            "flow label; rename that flow on its page. Do not delete the spare label: "
            "delete drops it instead of moving the items."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Label to remove, without #"},
                "into": {"type": "string", "description": "Existing label to keep, without #"},
            },
            "required": ["name", "into"],
        },
        handler=_merge_labels,
        gated=True,
        mutating=True,
        audience="both",
        display_name="Merge labels",
    )
)


register_tool(
    ToolSpec(
        name="create_tag",
        description=(
            "Create a plain label (no flow, no color) in the workspace catalog. "
            "To propose labels for conversations, companies or inbox rules, use "
            "propose_label_plan instead. Use create_category when the label should "
            "have a flow and start a ticket. Idempotent: an existing name is updated. "
            "Never say label or label."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Hashtag name without #"},
                "description": {"type": "string", "description": "When to apply it"},
                "show_in_nav": {"type": "boolean", "description": "Show in the Folders and tags rail for everyone"},
            },
            "required": ["name", "description"],
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
            "Rename or describe a hashtag, or change where it shows (show_in_nav, "
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


async def _propose_label_plan(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.decisions import _create_decision_request
    from app.services.label_plan import validate_entries
    from app.services.language import resolve_workspace_language

    lang = "nl" if resolve_workspace_language(await _get_tenant(ctx)) == "nl" else "en"
    entries, errors = await validate_entries(
        ctx.session, ctx.tenant_id, tool_input.get("entries"), lang=lang
    )
    if errors:
        return {
            "ok": False,
            "error": "plan_refused",
            "message": "No card was raised. Fix these lines and call propose_label_plan again.",
            "lines": errors,
        }
    question = str(tool_input.get("question") or "").strip()
    approve = "Toepassen" if lang == "nl" else "Apply"
    decisions: list[str] = []
    for entry in entries:
        title = f"#{entry['name']} · {entry['where']}"
        result = await _create_decision_request(
            ctx,
            {
                "title": title[:200],
                "summary": entry.get("description") or "",
                "question": question or None,
                "items": [
                    {"type": "tag", "name": entry["name"], "planned": True, "subtitle": entry["where"]}
                ],
                "options": [
                    {
                        "id": "approve",
                        "label": approve,
                        "action_type": "apply_label_plan",
                        "payload": entry,
                    },
                    {"id": "reject", "label": "Nee" if lang == "nl" else "Reject", "action_type": "reject"},
                ],
            },
        )
        if result.get("decision_request_id"):
            decisions.append(str(result["decision_request_id"]))
    return {
        "ok": True,
        "status": "awaiting_human",
        "decision_request_ids": decisions,
        "message": "The plan is on one card. Nothing changes until the operator approves; end your turn.",
    }


async def _apply_label_plan(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.label_plan import apply_entry

    return await apply_entry(ctx.session, ctx.tenant_id, tool_input, user_id=ctx.user_id)


register_tool(
    ToolSpec(
        name="propose_label_plan",
        description=(
            "Propose labels in one card the operator approves once. One line per "
            "label: label (existing name, or a new one with description), scope "
            "conversation (signal_ids it covers), company (company id, domain or "
            "name; every conversation from them inherits it), contact (id or email) "
            "or rule (match_type sender|domain|list_id + match_value; labels the "
            "next mail, and signal_ids are labelled now). Who sent it belongs on "
            "the company or a rule, not in the label name. The server refuses "
            "combined, duplicate or item labels and returns what to use instead."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string", "description": "One short line above the card"},
                "entries": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "description": "Name without #"},
                            "description": {"type": "string", "description": "When to apply it (new labels)"},
                            "scope": {"type": "string", "enum": ["conversation", "company", "contact", "rule"]},
                            "signal_ids": {"type": "array", "items": {"type": "string"}},
                            "company": {"type": "string"},
                            "contact": {"type": "string"},
                            "match_type": {"type": "string", "enum": ["sender", "domain", "list_id"]},
                            "match_value": {"type": "string"},
                        },
                        "required": ["label", "scope"],
                    },
                },
            },
            "required": ["entries"],
        },
        handler=_propose_label_plan,
        gated=False,
        audience="both",
        display_name="Proposed labels",
    )
)

register_tool(
    ToolSpec(
        name="apply_label_plan",
        description=(
            "Runs one approved line of a label plan. Do not call it yourself; "
            "propose_label_plan raises the card that runs it."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "scope": {"type": "string"},
                "signal_ids": {"type": "array", "items": {"type": "string"}},
                "company_id": {"type": "string"},
                "contact_id": {"type": "string"},
                "match_type": {"type": "string"},
                "match_value": {"type": "string"},
            },
            "required": ["name", "scope"],
        },
        handler=_apply_label_plan,
        gated=True,
        mutating=True,
        audience="both",
        display_name="Apply label",
    )
)

async def _set_contact_tags_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.signal_tags import set_contact_tags

    raw_id = tool_input.get("contact_id")
    try:
        contact_id = UUID(str(raw_id))
    except (TypeError, ValueError):
        return {"error": "invalid_id", "message": "contact_id must be a contact UUID"}
    names = tool_input.get("tags")
    if not isinstance(names, list):
        return {"error": "tags_required", "message": "Pass tags as a list of names."}
    tags = await set_contact_tags(
        ctx.session, ctx.tenant_id, contact_id, [str(name) for name in names], user_id=ctx.user_id
    )
    return {"ok": True, "contact_id": str(contact_id), "tags": tags}


register_tool(
    ToolSpec(
        name="set_contact_tags",
        description=(
            "Replace the tags on a contact. Those tags apply to every conversation "
            "of the contact (inherited, not copied). Conversations are refiled."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "contact_id": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["contact_id", "tags"],
        },
        handler=_set_contact_tags_tool,
        mutating=True,
        gated=True,
    )
)
