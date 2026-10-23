"""Agent tools for conversation-driven folder work (category: folders).

Lets agents recognize opportunities and bugs in conversations and turn them
into folder queue items, link work to smart-doc sections, and manage section
statuses — all under the tenant's allowance policy. In "ask" mode
create_queue_item renders an inline proposal card in the thread instead of
mutating directly.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.exceptions import AppError
from app.models.project import Project
from app.models.signal import Signal
from app.services.work_items import serialize_work_item
from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _resolve_project(
    ctx: ToolContext, tool_input: dict[str, Any]
) -> tuple[Project | None, str | None]:
    """Folder from explicit id/slug/name, then the thread's folder, then the run's.

    Returns ``(folder, error)``. ``error`` explains a failed explicit ref
    (unknown, Bin, wrong tenant); omitted when falling back to context.
    """
    from app.services.projects import resolve_folder_ref
    from app.services.trash import alive

    raw = str(tool_input.get("folder_id") or tool_input.get("project_id") or "").strip()
    if raw:
        project, err = await resolve_folder_ref(ctx.session, ctx.tenant_id, raw)
        return project, err
    if ctx.signal_id:
        signal = (
            await ctx.session.execute(
                select(Signal).where(Signal.id == ctx.signal_id, Signal.tenant_id == ctx.tenant_id)
            )
        ).scalar_one_or_none()
        if signal and signal.project_id:
            result = await ctx.session.execute(
                select(Project).where(
                    Project.id == signal.project_id,
                    Project.tenant_id == ctx.tenant_id,
                    alive(Project),
                )
            )
            project = result.scalar_one_or_none()
            if project is not None:
                return project, None
    if ctx.project_id:
        result = await ctx.session.execute(
            select(Project).where(
                Project.id == ctx.project_id,
                Project.tenant_id == ctx.tenant_id,
                alive(Project),
            )
        )
        project = result.scalar_one_or_none()
        if project is not None:
            return project, None
    return None, None


async def _list_projects(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.folders import folder_path_label, load_catalog

    catalog = await load_catalog(ctx.session, ctx.tenant_id)
    rows = {
        p.id: p
        for p in (
            await ctx.session.execute(select(Project).where(Project.tenant_id == ctx.tenant_id))
        ).scalars()
    }
    projects = [
        {
            "id": str(fs.id),
            "name": fs.name,
            "slug": fs.slug,
            "tag_ids": [str(t) for t in fs.tag_ids],
            "tag_names": list(fs.tag_names),
            "description": ((rows.get(fs.id).description or "")[:200] if rows.get(fs.id) else ""),
            "label": folder_path_label(fs),
            # Leading slash required so chat chips resolve as in-app folder links.
            "path": f"/folders/{fs.id}",
        }
        for fs in catalog.folders
    ]
    return {"folders": projects}


def _queue_folder_missing(
    *,
    err: str | None,
    kind: str | None = None,
) -> dict[str, Any]:
    """Shared error when queue tools need a live folder and none resolved."""
    kind_key = (kind or "").strip().lower()
    ticket_kinds = {"bug", "feature", "idea", "risk", "task"}
    hint = (
        "Pass folder_id from list_folders (live folders only — Bin folders fail). "
        "list_queue_items is the folder work queue, not open tickets."
    )
    if kind_key in ticket_kinds:
        hint = (
            f"kind={kind_key!r} alone does not pick a folder. "
            f"For open #{kind_key} tickets use list_threads with tag={kind_key!r}. "
            "For a folder queue, pass folder_id from list_folders."
        )
    message = err or "No live folder found. Pass folder_id (id or slug)."
    return {
        "error": "folder_not_found",
        "message": message,
        "hint": hint,
    }


async def _create_queue_item(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    project, err = await _resolve_project(ctx, tool_input)
    if project is None:
        return _queue_folder_missing(err=err, kind=str(tool_input.get("kind") or "") or None)
    title = str(tool_input.get("title") or "").strip()
    if not title:
        return {"error": "title is required"}
    kind = str(tool_input.get("kind") or "task")
    body = str(tool_input.get("body") or "")
    priority = str(tool_input.get("priority") or "normal")
    fields = tool_input.get("fields") if isinstance(tool_input.get("fields"), dict) else None

    if ctx.mode == "ask":
        # Inline proposal card in the thread; approval executes this tool again.
        from app.tools.executor import execute_tool

        payload = {
            "project_id": str(project.id),
            "kind": kind,
            "title": title,
            "body": body,
            "priority": priority,
            **({"fields": fields} if fields else {}),
        }
        return await execute_tool(
            ctx.session,
            ctx.tenant_id,
            ctx.user_id,
            "create_decision_request",
            {
                "title": f"Add to queue of {project.name}?",
                "summary": f"{kind}: {title}" + (f" — {body[:200]}" if body else ""),
                "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
                # Provenance for the card: the queue this item would join.
                "project_id": str(project.id),
                "options": [
                    {
                        "id": "approve",
                        "label": "Add to queue",
                        "action_type": "create_queue_item",
                        "payload": payload,
                        **(
                            {"learn": {"tool": "create_queue_item", "agent_id": str(ctx.agent.id), "reason": "", "rule_text": ""}}
                            if ctx.agent
                            else {}
                        ),
                    },
                    {"id": "reject", "label": "Dismiss", "action_type": "reject"},
                ],
            },
            signal_id=ctx.signal_id,
            agent=ctx.agent,
            run_id=ctx.run_id,
            trust=ctx.trust,
        )

    from app.services.project_work import create_queue_item
    from app.services.proposal_items import stash_attach_items

    item = await create_queue_item(
        ctx.session,
        ctx.tenant_id,
        project.id,
        kind=kind,
        title=title,
        body=body,
        priority=priority,
        origin_type="conversation" if ctx.signal_id else "agent",
        signal_id=ctx.signal_id,
        created_by_type="agent" if ctx.agent else "user",
        created_by_id=str(ctx.agent.id) if ctx.agent else str(ctx.user_id or ""),
        fields=fields,
    )
    try:
        meta = json.loads(item.metadata_json or "{}")
    except json.JSONDecodeError:
        meta = {}
    ticket_signal_id = (
        str(meta.get("ticket_signal_id") or "") if isinstance(meta, dict) else ""
    )
    showcase: list[dict[str, Any]] = []
    if ticket_signal_id:
        showcase = [{"type": "conversation", "id": ticket_signal_id}]
        stash_attach_items(ctx.signal_id, showcase)
    return {
        "queue_item": serialize_work_item(item, view="queue"),
        "status": "created",
        "ticket_signal_id": ticket_signal_id or None,
        "items": showcase,
    }


async def _list_queue_items(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    project, err = await _resolve_project(ctx, tool_input)
    if project is None:
        return _queue_folder_missing(err=err, kind=str(tool_input.get("kind") or "") or None)
    from app.services.project_work import list_queue_items

    items = await list_queue_items(
        ctx.session,
        ctx.tenant_id,
        project.id,
        status=tool_input.get("status"),
        kind=tool_input.get("kind"),
    )
    compact = [
        {
            "id": i["id"],
            "kind": i["kind"],
            "title": i["title"],
            "status": i["status"],
            "priority": i["priority"],
            "impact_summary": i["impact_summary"][:300],
            "links": [f"{link['heading']} [{link['section_status']}]" for link in i["links"]],
        }
        for i in items
    ]
    return {"folder": project.slug, "items": compact}


async def _update_queue_item_status(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.project_work import transition_queue_item, update_queue_item

    try:
        item_id = UUID(str(tool_input.get("queue_item_id") or ""))
    except ValueError:
        return {"error": "queue_item_id must be a valid id"}
    fields = tool_input.get("fields")
    if isinstance(fields, dict) and fields:
        item = await update_queue_item(ctx.session, ctx.tenant_id, item_id, fields=fields)
        if not tool_input.get("status"):
            return {"queue_item": serialize_work_item(item, view="queue")}
    if not tool_input.get("status"):
        return {"error": "Pass status, fields, or both."}
    duplicate_raw = str(tool_input.get("duplicate_of_id") or "").strip()
    duplicate_of = UUID(duplicate_raw) if duplicate_raw else None
    item = await transition_queue_item(
        ctx.session,
        ctx.tenant_id,
        item_id,
        str(tool_input.get("status") or ""),
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id) if ctx.agent else str(ctx.user_id or ""),
        impact_summary=tool_input.get("impact_summary"),
        duplicate_of_id=duplicate_of,
    )
    return {"queue_item": serialize_work_item(item, view="queue")}


async def _link_queue_item_to_doc(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.project_work import link_item_to_doc, link_item_to_section

    try:
        item_id = UUID(str(tool_input.get("queue_item_id") or ""))
    except ValueError:
        return {"error": "queue_item_id must be a valid id"}
    relation = str(tool_input.get("relation") or "touches")
    actor_type = "agent" if ctx.agent else "user"
    actor_id = str(ctx.agent.id) if ctx.agent else str(ctx.user_id or "")
    raw_doc = str(tool_input.get("doc_id") or "").strip()
    raw_section = str(tool_input.get("section_id") or "").strip()
    if raw_doc:
        try:
            doc_id = UUID(raw_doc)
        except ValueError:
            return {"error": "doc_id must be a valid id"}
        link = await link_item_to_doc(
            ctx.session,
            ctx.tenant_id,
            item_id,
            doc_id,
            relation=relation,
            created_by_type=actor_type,
            created_by_id=actor_id,
        )
        return {
            "link_id": str(link.id),
            "doc_id": str(link.doc_id) if link.doc_id else None,
            "relation": link.relation,
            "status": "linked",
        }
    if not raw_section:
        return {"error": "doc_id (preferred) or section_id is required"}
    try:
        section_id = UUID(raw_section)
    except ValueError:
        return {"error": "section_id must be a valid id"}
    link = await link_item_to_section(
        ctx.session,
        ctx.tenant_id,
        item_id,
        section_id,
        relation=relation,
        created_by_type=actor_type,
        created_by_id=actor_id,
    )
    return {
        "link_id": str(link.id),
        "doc_id": str(link.doc_id) if link.doc_id else None,
        "section_id": str(link.section_id) if link.section_id else None,
        "relation": link.relation,
        "status": "linked",
    }


async def _set_doc_section_status(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.project_work import serialize_section, set_section_status

    try:
        section_id = UUID(str(tool_input.get("section_id") or ""))
    except ValueError:
        return {"error": "section_id must be a valid id"}
    section = await set_section_status(
        ctx.session,
        ctx.tenant_id,
        section_id,
        str(tool_input.get("status") or ""),
        actor_type="agent" if ctx.agent else "user",
        actor_id=str(ctx.agent.id) if ctx.agent else str(ctx.user_id or ""),
        summary=tool_input.get("summary"),
    )
    return {"section": serialize_section(section)}


async def _list_project_docs(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    project, err = await _resolve_project(ctx, tool_input)
    if project is None:
        return _queue_folder_missing(err=err)
    from app.services.project_work import (
        active_requests_for_docs,
        links_for_sections,
        sections_for_project,
    )
    from app.services.workspace import list_docs

    docs = await list_docs(ctx.session, ctx.tenant_id, project_id=project.id)
    sections = await sections_for_project(ctx.session, ctx.tenant_id, project.id)
    links = await links_for_sections(ctx.session, ctx.tenant_id, [s.id for s in sections])
    linked = await active_requests_for_docs(ctx.session, ctx.tenant_id, [d.id for d in docs])
    by_doc: dict[Any, list[Any]] = {}
    for section in sections:
        by_doc.setdefault(section.doc_id, []).append(section)
    return {
        "folder": project.slug,
        "docs": [
            {
                "doc_id": str(doc.id),
                "path": doc.path,
                "title": doc.title,
                "linked_requests": linked.get(doc.id, []),
                "sections": [
                    {
                        "section_id": str(s.id),
                        "heading": s.heading,
                        "status": s.status,
                        "linked_items": [
                            f"{link['title']} [{link['status']}]" for link in links.get(s.id, [])
                        ],
                    }
                    for s in by_doc.get(doc.id, [])
                ],
            }
            for doc in docs
        ],
    }


async def _list_project_resources(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    project, err = await _resolve_project(ctx, tool_input)
    if project is None:
        return _queue_folder_missing(err=err)
    from app.services.project_work import list_resources

    return {"folder": project.slug, "resources": await list_resources(ctx.session, ctx.tenant_id, project.id)}


async def _propose_project_resource(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    project, err = await _resolve_project(ctx, tool_input)
    if project is None:
        return _queue_folder_missing(err=err)
    resource_type = str(tool_input.get("resource_type") or "other")
    if resource_type == "connection":
        return {"error": "Link connections with set_connection_scope (project_ids)."}
    provider = str(tool_input.get("provider") or "")
    label = str(tool_input.get("label") or "")
    external_ref = str(tool_input.get("external_ref") or "")

    if ctx.mode == "ask":
        from app.tools.executor import execute_tool

        payload = {
            "project_id": str(project.id),
            "resource_type": resource_type,
            "provider": provider,
            "label": label,
            "external_ref": external_ref,
        }
        return await execute_tool(
            ctx.session,
            ctx.tenant_id,
            ctx.user_id,
            "create_decision_request",
            {
                "title": f"Link {resource_type} resource to {project.name}?",
                "summary": f"{provider or resource_type}: {label or external_ref}",
                "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
                "options": [
                    {
                        "id": "approve",
                        "label": "Link resource",
                        "action_type": "propose_project_resource",
                        "payload": payload,
                    },
                    {"id": "reject", "label": "Dismiss", "action_type": "reject"},
                ],
            },
            signal_id=ctx.signal_id,
            agent=ctx.agent,
            run_id=ctx.run_id,
            trust=ctx.trust,
        )

    from app.services.project_work import create_resource

    resource = await create_resource(
        ctx.session,
        ctx.tenant_id,
        project.id,
        resource_type=resource_type,
        provider=provider,
        label=label,
        external_ref=external_ref,
        config=tool_input.get("config") if isinstance(tool_input.get("config"), dict) else None,
        created_by_type="agent" if ctx.agent else "user",
        created_by_id=str(ctx.agent.id) if ctx.agent else str(ctx.user_id or ""),
    )
    return {"resource": resource, "status": "linked"}


register_tool(
    ToolSpec(
        name="list_folders",
        description=(
            "List folders (Mappen): places where work on one subject is filed. "
            "Not departments (Afdelingen). When someone says map or folder, or "
            "wants to store work in one, use this tool — never list_departments. "
            "Returns id, slug, tag_ids, tag_names, label, path. "
            "Prefer the folder id as parent_id for create_folder. A lookup does "
            "not show cards. Call attach_items (type folder) when you want "
            "folder cards, and chip names inline with [Name](path) using the "
            "returned path (always starts with /folders/…)."
        ),
        category="projects",
        input_schema={"type": "object", "properties": {}},
        handler=_list_projects,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="create_queue_item",
        description=(
            "Turn one distinct issue from this chat into work in a folder. Call once "
            "per issue (three bugs → three calls). This chat stays the reporting "
            "thread; each call spawns a child conversation, files it as a ticket "
            "when kind matches a label with a flow on the folder (bug → #bug, feature → "
            "#feature), and showcases that ticket in your reply. Do not use "
            "split_conversation on assistant chats — that tool is for customer "
            "threads only. Under 'ask' policy this renders an inline proposal card. "
            "kind post with fields (date, channel, caption, image) is a content calendar "
            "entry; the folder's linked Sheet follows each change."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Folder id or slug; omit to use the thread's folder."},
                "kind": {"type": "string", "enum": ["feature", "bug", "task", "idea", "risk", "post"]},
                "fields": {
                    "type": "object",
                    "description": "Calendar entry: date (YYYY-MM-DD), channel, caption, image (url).",
                    "properties": {
                        "date": {"type": "string"},
                        "channel": {"type": "string"},
                        "caption": {"type": "string"},
                        "image": {"type": "string"},
                    },
                },
                "title": {"type": "string"},
                "body": {"type": "string", "description": "Context: what, why, and the source quote."},
                "priority": {"type": "string", "enum": ["low", "normal", "high", "urgent"]},
            },
            "required": ["title"],
        },
        handler=_create_queue_item,
        handles_ask=True,
    )
)

register_tool(
    ToolSpec(
        name="list_queue_items",
        description=(
            "List work-queue rows on one live folder (status, kind, linked doc sections). "
            "Requires folder_id / project_id from list_folders. "
            "Not for open #bug/#feature tickets — those are conversations; use "
            "list_threads with tag='bug' (or tag='feature', or tag='bug,feature'). "
            "kind filters queue rows on that folder only; it does not replace folder_id."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "folder_id": {
                    "type": "string",
                    "description": "Folder id or slug (preferred). Alias: project_id.",
                },
                "project_id": {"type": "string", "description": "Alias for folder_id."},
                "status": {"type": "string"},
                "kind": {
                    "type": "string",
                    "description": (
                        "Optional queue-row kind filter on that folder (bug/feature/task/…). "
                        "Does not list tickets workspace-wide."
                    ),
                },
            },
        },
        handler=_list_queue_items,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="update_queue_item_status",
        description=(
            "Move a queue task through its lifecycle (proposed -> queued -> "
            "analyzing -> planned -> running -> verifying -> completed; rejected). "
            "Include impact_summary when finishing an analysis. Pass fields to change a "
            "calendar entry (date, channel, caption, image); status may then be omitted."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "queue_item_id": {"type": "string"},
                "status": {"type": "string", "enum": [
                    "proposed", "queued", "analyzing", "planned",
                    "running", "verifying", "completed", "rejected",
                ]},
                "impact_summary": {"type": "string"},
                "duplicate_of_id": {"type": "string"},
                "fields": {"type": "object", "description": "Calendar entry fields to change."},
            },
            "required": ["queue_item_id"],
        },
        handler=_update_queue_item_status,
    )
)

register_tool(
    ToolSpec(
        name="link_queue_item_to_doc",
        description=(
            "Link a queue item to a knowledge document it implements, modifies, "
            "touches, or documents. Prefer doc_id (document-level). section_id is "
            "legacy only. Get doc ids from list_folder_docs or list_docs."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "queue_item_id": {"type": "string"},
                "doc_id": {
                    "type": "string",
                    "description": "Workspace doc id (preferred document-level link).",
                },
                "section_id": {
                    "type": "string",
                    "description": "Legacy section id; prefer doc_id.",
                },
                "relation": {
                    "type": "string",
                    "enum": ["implements", "modifies", "touches", "documents"],
                },
            },
            "required": ["queue_item_id"],
        },
        handler=_link_queue_item_to_doc,
    )
)

register_tool(
    ToolSpec(
        name="set_doc_section_status",
        description=(
            "Set the maturity of a knowledge section: draft (concept), review "
            "(written, awaiting verification), final (verified against reality). "
            "Only mark final after checking reality matches the documentation."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "section_id": {"type": "string"},
                "status": {"type": "string", "enum": ["draft", "review", "final"]},
                "summary": {"type": "string", "description": "One-line summary of what the section covers."},
            },
            "required": ["section_id", "status"],
        },
        handler=_set_doc_section_status,
    )
)

register_tool(
    ToolSpec(
        name="list_folder_docs",
        description="List a folder's documentation with section statuses and linked queue items.",
        category="projects",
        input_schema={
            "type": "object",
            "properties": {"project_id": {"type": "string"}},
        },
        handler=_list_project_docs,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="list_folder_resources",
        description=(
            "List a folder's Works in items that live outside Bokito (repo, drive, "
            "notion, vibecode, connection). Work written through these lands in the "
            "folder as Delivered. Connection rows belong to this folder only; their "
            "connection_id works with set_connection_scope."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {"project_id": {"type": "string"}},
        },
        handler=_list_project_resources,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="propose_folder_resource",
        description=(
            "Propose adding an external resource (repo, drive, notion, sheet, "
            "vibecode, site) to a folder's Works in. Records the slot and reference; "
            "the actual connector is configured later by a human."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "resource_type": {"type": "string", "enum": ["repo", "drive", "notion", "sheet", "vibecode", "site", "other"]},
                "provider": {"type": "string"},
                "label": {"type": "string"},
                "external_ref": {"type": "string"},
            },
            "required": ["resource_type"],
        },
        handler=_propose_project_resource,
        handles_ask=True,
    )
)


def _canvas_source(value: Any) -> str | None:
    from app.services.canvas_content import coerce_canvas_source

    return coerce_canvas_source(value)


def _canvas_link(row: dict[str, Any]) -> str | None:
    """In-app path for a canvas row. Lookups return this; they do not showcase."""
    from app.services.works_in import folder_href

    cid = row.get("id")
    folder_id = row.get("folder_id")
    if not cid:
        return None
    if folder_id:
        return folder_href(folder_id, "canvas", canvas=str(cid))
    thread = row.get("thread") if isinstance(row.get("thread"), dict) else None
    if thread and thread.get("path"):
        from app.services.project_canvas import canvas_on_thread

        return canvas_on_thread(str(thread["path"]), cid)
    return None


async def _stash_canvas_showcase(
    ctx: ToolContext, canvases: list[dict[str, Any]] | dict[str, Any] | None
) -> list[dict[str, Any]]:
    """Resolve canvas snapshots and attach them under the agent reply."""
    from app.services.proposal_items import resolve_items, stash_attach_items

    rows = canvases if isinstance(canvases, list) else ([canvases] if isinstance(canvases, dict) else [])
    refs = [{"type": "canvas", "id": c["id"]} for c in rows if isinstance(c, dict) and c.get("id")]
    if not refs:
        return []
    showcase = await resolve_items(ctx.session, ctx.tenant_id, refs)
    if showcase:
        stash_attach_items(ctx.signal_id, showcase)
    return showcase


def _canvas_reply(result: dict[str, Any], showcase: list[dict[str, Any]]) -> dict[str, Any]:
    path = showcase[0].get("path") if showcase else None
    body = {**result, "items": showcase}
    if path:
        body["path"] = path
    return body


async def _get_project_canvas(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from fastapi import HTTPException

    from app.services import project_canvas as canvas_svc

    canvas_id = str(tool_input.get("canvas_id") or "").strip()
    if canvas_id:
        canvas = await canvas_svc.get_canvas(ctx.session, ctx.tenant_id, canvas_id=_UUID(canvas_id))
        return {**canvas, "path": _canvas_link(canvas)}
    if not ctx.signal_id:
        return {"error": "Pass canvas_id, or call this from a conversation."}
    slug = str(tool_input.get("slug") or "main").strip().lower() or "main"
    try:
        canvas = await canvas_svc.get_canvas(
            ctx.session,
            ctx.tenant_id,
            signal_id=ctx.signal_id,
            slug=slug,
        )
        return {**canvas, "path": _canvas_link(canvas)}
    except (HTTPException, AppError):
        listed = await canvas_svc.list_canvases_for_signal(
            ctx.session, ctx.tenant_id, ctx.signal_id
        )
        return {
            "error": "Canvas not found. Pass canvas_id or slug from this list.",
            "canvases": [
                {"id": i["id"], "slug": i["slug"], "title": i["title"], "path": _canvas_link(i)}
                for i in listed
            ],
        }

async def _propose_canvas_change(
    ctx: ToolContext,
    *,
    change_kind: str,
    after: dict[str, Any],
    before: dict[str, Any],
    summary: str,
    tool_name: str,
) -> dict[str, Any]:
    from app.models.auth import Tenant
    from app.services.platform_changes import propose_platform_change

    tenant = (
        await ctx.session.execute(select(Tenant).where(Tenant.id == ctx.tenant_id))
    ).scalar_one()
    change, meta = await propose_platform_change(
        ctx.session,
        tenant,
        resource_type="project_canvas",
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
        "message": "Canvas change submitted for review",
    }


async def _edit_canvas_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Write the body onto an existing canvas. Alias of the edit step."""
    return await _update_project_canvas(ctx, tool_input, tool_name="edit_canvas")


async def _update_project_canvas(
    ctx: ToolContext,
    tool_input: dict[str, Any],
    *,
    tool_name: str = "edit_canvas",
) -> dict[str, Any]:
    canvas_id = str(tool_input.get("canvas_id") or "").strip()
    slug = str(tool_input.get("slug") or "").strip().lower()
    if not canvas_id and not slug:
        return {
            "error": (
                "Pass canvas_id from create_canvas, list_canvases, or get_folder_canvas. "
                "Call edit_canvas on that id. Do not create another canvas."
            )
        }
    notes = str(tool_input.get("notes") or "").strip()
    source = tool_input.get("source")
    blocks = tool_input.get("blocks")
    reset = bool(tool_input.get("reset"))
    has_meta = any(
        tool_input.get(key) not in (None, "")
        for key in ("refresh_cadence", "refresh_cron", "managing_agent_id")
    )
    image_prompt = str(tool_input.get("image_prompt") or "").strip()
    image_url = str(tool_input.get("image_url") or "").strip()
    if (
        not reset
        and source is None
        and blocks is None
        and not has_meta
        and not image_prompt
        and not image_url
    ):
        return {
            "error": (
                "Pass blocks for a dashboard, source for another kind, "
                "image_prompt or image_url for an image, or reset=true to clear it."
            )
        }
    design_notes: list[str] = []
    if blocks is not None:
        from app.services.canvas_blocks import polish_blocks, render_problems, validate_blocks

        cleaned, errors = validate_blocks(blocks)
        problems = render_problems(cleaned) if not errors else []
        if errors or problems:
            found = errors or problems
            return {
                "status": "invalid",
                "error": found[0],
                "errors": found,
                "hint": (
                    "Fix only the paths named above and call edit_canvas again with the "
                    "same canvas_id. Put fields on the block itself, e.g. "
                    '{"type": "bar_chart", "title": "Trend", "labels": ["a", "b"], '
                    '"series": [{"name": "Aantal", "values": [1, 2]}]}. '
                    "Do not paste the blocks in chat."
                ),
            }
        blocks, design_notes = polish_blocks(cleaned)
    after: dict[str, Any] = {
        "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
        "slug": slug or None,
        "notes": notes or None,
        "agent_id": str(ctx.agent.id) if ctx.agent else "",
        "updated_by_id": str(ctx.agent.id) if ctx.agent else str(ctx.user_id or ""),
        "reset": reset,
    }
    if canvas_id:
        after["canvas_id"] = canvas_id
    if tool_input.get("title") is not None:
        after["title"] = str(tool_input.get("title") or "")
    if blocks is not None:
        after["blocks"] = blocks
    elif source is not None:
        after["source"] = _canvas_source(source)
    if tool_input.get("language"):
        after["language"] = str(tool_input.get("language") or "")
    if image_prompt:
        after["image_prompt"] = image_prompt
    if image_url:
        after["image_url"] = image_url
    if tool_input.get("refresh_cadence"):
        after["refresh_cadence"] = str(tool_input.get("refresh_cadence"))
    if tool_input.get("refresh_cron"):
        after["refresh_cron"] = str(tool_input.get("refresh_cron"))
    manager = str(tool_input.get("managing_agent_id") or "").strip()
    if manager:
        from uuid import UUID as _UUID

        try:
            _UUID(manager)
        except ValueError:
            return {"error": "managing_agent_id must be an agent id"}
        after["managing_agent_id"] = manager
    label = str(tool_input.get("title") or slug or canvas_id or "canvas")
    summary = notes or f"Update canvas '{label}'"
    result = await _propose_canvas_change(
        ctx,
        change_kind="update",
        after=after,
        before={"canvas_id": canvas_id or None, "slug": slug or None},
        summary=summary,
        tool_name=tool_name,
    )
    canvas = result.get("canvas") if isinstance(result, dict) else None
    if isinstance(canvas, dict) and canvas.get("id"):
        if ctx.agent is not None and canvas.get("folder_id"):
            from uuid import UUID as _UUID

            from app.services.deliveries import TARGET_WORKS_IN, record_delivery
            from app.services.works_in import canvas_key

            await record_delivery(
                ctx.session,
                ctx.tenant_id,
                ctx.signal_id,
                target_kind=TARGET_WORKS_IN,
                folder_id=_UUID(str(canvas["folder_id"])),
                works_in_key=canvas_key(canvas["id"]),
                agent_id=ctx.agent.id,
            )
            await ctx.session.commit()
        showcase = await _stash_canvas_showcase(ctx, canvas)
        reply = _canvas_reply(result, showcase)
        reply["next"] = (
            "Call finish_canvas with this canvas_id. That is the done step. "
            "Do not paste blocks or source in chat."
        )
        if design_notes:
            reply["design_notes"] = design_notes
            reply["next"] = (
                "Saved. The design_notes are optional improvements: apply them with "
                "one more edit_canvas only if the data allows, then finish_canvas."
            )
        return reply
    return result


def existing_canvas_of_kind(
    listed: list[dict[str, Any]], tool_input: dict[str, Any]
) -> dict[str, Any] | None:
    """The single canvas of this kind already on the conversation, if any.

    ``force_new`` or ``new_thread`` starts another. Several of the same kind
    leave create alone: the model picks one with ``edit_canvas``.
    """
    if tool_input.get("force_new") or tool_input.get("new_thread"):
        return None
    from app.services.canvas_content import CanvasContentError, normalize_kind

    try:
        kind = normalize_kind(str(tool_input.get("kind") or "") or None)
    except CanvasContentError:
        return None
    same = [
        row
        for row in listed
        if isinstance(row, dict)
        and row.get("id")
        and str(row.get("kind") or "dashboard") == kind
    ]
    if len(same) != 1:
        return None
    return same[0]


def revision_canvas(listed: list[dict[str, Any]], tool_input: dict[str, Any]) -> dict[str, Any] | None:
    """Back-compat name: one same-kind canvas when a body was passed on create."""
    has_body = any(
        str(tool_input.get(key) or "").strip()
        for key in ("source", "image_prompt", "image_url")
    )
    if not has_body:
        return None
    return existing_canvas_of_kind(listed, tool_input)


def _with_skill(reply: dict[str, Any], kind: str, tool_input: dict[str, Any]) -> dict[str, Any]:
    """A dashboard reply carries its skill guide, read right before edit_canvas."""
    if kind != "dashboard":
        return reply
    from app.services.canvas_skills import skill_brief

    reply["skill"] = skill_brief(str(tool_input.get("skill") or ""))
    return reply


async def _create_canvas_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Span an empty canvas. The body belongs on a later edit_canvas call."""
    from uuid import UUID as _UUID

    title = str(tool_input.get("title") or "").strip()
    if not title:
        return {"error": "title is required"}
    if not ctx.signal_id and not tool_input.get("new_thread"):
        return {"error": "create_canvas needs this conversation, or new_thread=true"}
    named_owner = str(tool_input.get("managing_agent_id") or "").strip()
    if named_owner:
        try:
            _UUID(named_owner)
        except ValueError:
            return {"error": "managing_agent_id must be an agent id"}
        manager = named_owner
    else:
        manager = str(ctx.agent.id) if ctx.agent else None
    # create_canvas only opens the empty pane. Source goes on edit_canvas next.
    after = {
        "title": title,
        "slug": str(tool_input.get("slug") or "") or None,
        "refresh_minutes": tool_input.get("refresh_minutes"),
        "refresh_cadence": tool_input.get("refresh_cadence"),
        "refresh_cron": str(tool_input.get("refresh_cron") or "") or None,
        "notes": str(tool_input.get("notes") or "") or None,
        "managing_agent_id": manager,
        "agent_id": str(ctx.agent.id) if ctx.agent else "",
        # The agent writes the document in this conversation. A parallel refresh
        # wake opened a second thread and asked the operator questions.
        "kick": ctx.agent is None,
        "force_new": bool(tool_input.get("force_new")),
        "new_thread": bool(tool_input.get("new_thread")),
        "signal_id": (
            str(ctx.signal_id)
            if ctx.signal_id and not tool_input.get("new_thread")
            else None
        ),
        "canvas_kind": str(tool_input.get("kind") or "dashboard"),
        "language": str(tool_input.get("language") or "") or None,
        "source": None,
        "image_prompt": None,
        "image_url": None,
    }
    if ctx.signal_id and not tool_input.get("new_thread") and not tool_input.get("force_new"):
        from app.services import project_canvas as canvas_svc

        listed = await canvas_svc.list_canvases_for_signal(
            ctx.session, ctx.tenant_id, ctx.signal_id
        )
        existing = existing_canvas_of_kind(listed, tool_input)
        if existing is not None:
            canvas_id = str(existing["id"])
            # Do not showcase an empty shell — that left "writing" ghosts when the
            # turn died before edit_canvas. Point the model at edit instead.
            from app.services.canvas_content import edit_body_hint

            kind = str(existing.get("kind") or tool_input.get("kind") or "dashboard")
            body = {
                "status": "exists",
                "canvas_id": canvas_id,
                "canvas": existing,
                "path": _canvas_link(existing),
                "message": (
                    "This conversation already has that canvas. "
                    f"Call edit_canvas with this canvas_id and {edit_body_hint(kind)}, "
                    "then finish_canvas. Do not call create_canvas again."
                ),
                "next": "edit_canvas then finish_canvas",
            }
            _with_skill(body, kind, tool_input)
            if not existing.get("empty"):
                showcase = await _stash_canvas_showcase(ctx, existing)
                return _canvas_reply(body, showcase)
            return body
    result = await _propose_canvas_change(
        ctx,
        change_kind="create",
        after=after,
        before={},
        summary=f"Create canvas '{title}'",
        tool_name="create_canvas",
    )
    canvas = result.get("canvas") if isinstance(result, dict) else None
    if isinstance(canvas, dict) and canvas.get("id"):
        # Empty create only returns the id. edit_canvas / finish_canvas attach
        # the card once there is something to show — no permanent writing ghost.
        from app.services.canvas_content import edit_body_hint

        kind = str(canvas.get("kind") or tool_input.get("kind") or "dashboard")
        reply = {
            **result,
            "canvas_id": str(canvas["id"]),
            "path": _canvas_link(canvas),
            "next": (
                f"Call edit_canvas with this canvas_id and {edit_body_hint(kind)}, "
                "then finish_canvas. Do not paste blocks or source in chat."
            ),
        }
        if canvas.get("reused") and not canvas.get("empty"):
            showcase = await _stash_canvas_showcase(ctx, canvas)
            reply = _canvas_reply(reply, showcase)
            reply["reused"] = True
            reply["message"] = (
                "A canvas with this title already exists. Call edit_canvas "
                "with this canvas_id, then finish_canvas. Do not call create_canvas again."
            )
            reply["next"] = "edit_canvas then finish_canvas"
        elif canvas.get("reused"):
            reply["reused"] = True
            reply["message"] = (
                "A canvas with this title already exists but is still empty. "
                "Call edit_canvas with this canvas_id, then finish_canvas."
            )
            reply["next"] = "edit_canvas then finish_canvas"
        return _with_skill(reply, kind, tool_input)
    return result


async def _finish_canvas_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Mark the canvas done. This confirmation is the activity trail, not chat text."""
    from uuid import UUID as _UUID

    from fastapi import HTTPException

    from app.services import project_canvas as canvas_svc

    canvas_id = str(tool_input.get("canvas_id") or "").strip()
    if not canvas_id:
        return {"error": "Pass canvas_id from create_canvas or edit_canvas."}
    try:
        canvas = await canvas_svc.get_canvas(
            ctx.session, ctx.tenant_id, canvas_id=_UUID(canvas_id)
        )
    except (HTTPException, AppError):
        return {"error": "Canvas not found. Pass the canvas_id from edit_canvas."}
    except Exception:
        return {"error": "Canvas not found. Pass the canvas_id from edit_canvas."}
    problems: list[str] = []
    if (canvas.get("kind") or "dashboard") == "dashboard":
        from app.services.canvas_blocks import render_problems

        problems = render_problems(canvas.get("blocks") or [])
    if canvas.get("empty") or problems:
        from app.services.canvas_content import edit_body_hint

        kind = str(canvas.get("kind") or "dashboard")
        found = problems or [
            f"The canvas is still empty. Call edit_canvas with {edit_body_hint(kind)} "
            "first, then finish_canvas."
        ]
        return {
            "status": "invalid",
            "error": found[0],
            "errors": found,
            "canvas_id": canvas_id,
        }
    showcase = await _stash_canvas_showcase(ctx, canvas)
    return _canvas_reply(
        {
            "status": "finished",
            "canvas_id": canvas_id,
            "canvas": canvas,
            "message": (
                "Canvas finished. The operator sees this confirmation in the activity "
                "trail. Do not also announce that it is done in the chat message."
            ),
        },
        showcase,
    )


async def _delete_canvas_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services import project_canvas as canvas_svc

    canvas_id = str(tool_input.get("canvas_id") or "").strip()
    if not canvas_id:
        slug = str(tool_input.get("slug") or "").strip().lower()
        if not slug or not ctx.signal_id:
            return {"error": "Pass canvas_id, or slug in this conversation"}
        current = await canvas_svc.get_canvas(
            ctx.session, ctx.tenant_id, signal_id=ctx.signal_id, slug=slug
        )
        canvas_id = current["id"]
    return await _propose_canvas_change(
        ctx,
        change_kind="delete",
        after={"canvas_id": canvas_id},
        before={"canvas_id": canvas_id},
        summary="Delete canvas",
        tool_name="delete_canvas",
    )


async def _list_canvases_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.services import project_canvas as canvas_svc

    project_raw = str(tool_input.get("project_id") or tool_input.get("owner_id") or "").strip()
    if project_raw:
        listed = await canvas_svc.list_canvases_for_folder(
            ctx.session, ctx.tenant_id, _UUID(project_raw)
        )
        folder_id: str | None = project_raw
    elif ctx.signal_id:
        signal = await ctx.session.get(Signal, ctx.signal_id)
        if signal is not None and signal.tenant_id == ctx.tenant_id and signal.project_id:
            listed = await canvas_svc.list_canvases_for_folder(
                ctx.session, ctx.tenant_id, signal.project_id
            )
            folder_id = str(signal.project_id)
        else:
            listed = await canvas_svc.list_canvases_for_signal(
                ctx.session, ctx.tenant_id, ctx.signal_id
            )
            folder_id = None
    else:
        return {"error": "Pass project_id, or call this from a conversation."}
    return {
        "folder_id": folder_id,
        "canvases": [
            {
                "id": i["id"],
                "slug": i["slug"],
                "title": i["title"],
                "kind": i.get("kind") or "dashboard",
                "empty": i.get("empty"),
                "signal_id": i.get("signal_id"),
                "folder_id": i.get("folder_id"),
                "path": _canvas_link(i),
            }
            for i in listed
        ],
    }


register_tool(
    ToolSpec(
        name="list_canvases",
        description=(
            "List canvases for this conversation's folder (and its subfolders), "
            "or pass project_id for a folder. Each canvas belongs to one home "
            "conversation (signal_id). kind is dashboard, document, diagram, "
            "drawing, image, code, email, or sheet. A lookup does not show cards. "
            "Link each path inline."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "owner_id": {"type": "string"},
            },
        },
        handler=_list_canvases_tool,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="get_folder_canvas",
        description=(
            "Read a snapshot canvas. A dashboard comes back as blocks (not JSX). "
            "Other kinds come back as source. Not live queue/budget data. "
            "Pass canvas_id, or slug on this conversation. "
            "A lookup does not show a card. Call attach_items (type canvas) when "
            "you want a preview card. Link the returned path inline, for example "
            "[Title](path)."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "canvas_id": {"type": "string"},
                "slug": {"type": "string"},
            },
        },
        handler=_get_project_canvas,
        mutating=False,
        gated=False,
    )
)

def _canvas_skill_ids() -> list[str]:
    from app.services.canvas_skills import skill_ids

    return skill_ids()


def _edit_canvas_schema() -> dict[str, Any]:
    from app.services.canvas_blocks import blocks_json_schema

    return {
        "type": "object",
        "properties": {
            "canvas_id": {"type": "string"},
            "project_id": {"type": "string"},
            "slug": {"type": "string"},
            "blocks": blocks_json_schema(),
            "source": {
                "type": "string",
                "description": (
                    "Body for a non-dashboard canvas: markdown, mermaid, SVG, code, "
                    "email JSON, or sheet JSON. Dashboards use blocks, not source."
                ),
            },
            "title": {"type": "string"},
            "notes": {"type": "string"},
            "reset": {"type": "boolean"},
        "refresh_cadence": {
            "type": "string",
            "enum": ["manual", "hourly", "daily", "weekly", "monthly", "custom"],
        },
        "refresh_cron": {"type": "string"},
        "managing_agent_id": {"type": "string"},
        "language": {"type": "string"},
        "image_prompt": {"type": "string"},
        "image_url": {"type": "string"},
        },
    }


_EDIT_CANVAS_SCHEMA = _edit_canvas_schema()

_EDIT_CANVAS_DESCRIPTION = (
    "Edit step: write the full body onto one existing canvas. Pass canvas_id "
    "from create_canvas or from the canvases already on this conversation. "
    "While this runs the operator sees the writing animation. "
    "It does not create another canvas. "
    "A dashboard takes blocks: a flat list in reading order, for example "
    '[{"type":"heading","text":"Omzet 12% boven plan"},'
    '{"type":"stat","label":"Omzet","value":"EUR 84k","delta":"+12%","status":"good"},'
    '{"type":"bar_chart","title":"Per regio","labels":["Noord","Zuid"],'
    '"series":[{"name":"Omzet","values":[48,36]}]}]. '
    "The server lays it out: stats in a row become the KPI strip, charts in a "
    "row share columns (wide=true for full width). Do not use grid or card for layout. "
    "Chart values must be numbers and the same length as labels. "
    "Types: heading, text, callout, stat, bar_chart, line_chart, area_chart, "
    "pie_chart, table, list, divider. No JSX, no BoxPlot, no ScatterPlot. "
    "A successful edit may return design_notes: optional improvements. "
    "document is markdown. diagram is mermaid. drawing is one SVG. image takes "
    "image_prompt or image_url. code takes language and source. email is JSON "
    "subject/preheader/body_html. sheet is JSON columns and rows. "
    "If this returns an error, fix the blocks and call edit_canvas again with "
    "the same canvas_id. After a successful edit, call finish_canvas."
)

register_tool(
    ToolSpec(
        name="edit_canvas",
        description=_EDIT_CANVAS_DESCRIPTION,
        category="projects",
        input_schema=_EDIT_CANVAS_SCHEMA,
        handler=_edit_canvas_tool,
    )
)

async def _update_folder_canvas_alias(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    return await _update_project_canvas(ctx, tool_input, tool_name="update_folder_canvas")


register_tool(
    ToolSpec(
        name="update_folder_canvas",
        description=(
            "Same as edit_canvas (kept for canvas refresh wakes). Prefer "
            "edit_canvas in operator chat. " + _EDIT_CANVAS_DESCRIPTION
        ),
        category="projects",
        input_schema=_EDIT_CANVAS_SCHEMA,
        handler=_update_folder_canvas_alias,
    )
)

register_tool(
    ToolSpec(
        name="create_canvas",
        description=(
            "Create step: open an empty canvas on this conversation in one short "
            "call (title, kind, optional refresh). Do not pass blocks or source "
            "here — that belongs on edit_canvas next. "
            "kind is dashboard (default), document, diagram, drawing, image, "
            "code, email, or sheet. For a dashboard pass skill (overview, trend, "
            "breakdown, comparison, report); the result returns that recipe with "
            "rules and an example to follow on edit_canvas. Drawing is one SVG; "
            "diagram is Mermaid; document is markdown. "
            "When this conversation already has exactly one canvas of this kind, "
            "create_canvas returns that canvas_id — call edit_canvas then "
            "finish_canvas; do not create another. Pass force_new only when they "
            "asked for a separate canvas. "
            "Order for a new canvas: one short sentence, create_canvas (empty), "
            "edit_canvas (blocks for dashboard, Mermaid source for diagram, …), "
            "finish_canvas. "
            "Order for a change to an existing canvas: edit_canvas, finish_canvas. "
            "Never paste blocks or source into the chat message."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "slug": {"type": "string"},
                "refresh_minutes": {"type": "integer"},
                "refresh_cadence": {
                    "type": "string",
                    "enum": ["manual", "hourly", "daily", "weekly", "monthly", "custom"],
                },
                "refresh_cron": {"type": "string"},
                "managing_agent_id": {"type": "string"},
                "notes": {"type": "string"},
                "force_new": {"type": "boolean"},
                "new_thread": {"type": "boolean"},
                "kind": {
                    "type": "string",
                    "enum": [
                        "dashboard",
                        "document",
                        "diagram",
                        "drawing",
                        "image",
                        "code",
                        "email",
                        "sheet",
                    ],
                },
                "language": {"type": "string"},
                "skill": {
                    "type": "string",
                    "enum": _canvas_skill_ids(),
                    "description": (
                        "Dashboard recipe. The result returns its rules, steps and an "
                        "example; follow them on edit_canvas."
                    ),
                },
            },
            "required": ["title"],
        },
        handler=_create_canvas_tool,
    )
)

register_tool(
    ToolSpec(
        name="finish_canvas",
        description=(
            "Finish step: confirm the canvas is done after a successful "
            "edit_canvas. Pass that canvas_id. This confirmation is its own "
            "activity step — do not also write that it is finished in the chat "
            "message. Call this once per canvas you edited in the turn."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "canvas_id": {"type": "string"},
            },
            "required": ["canvas_id"],
        },
        handler=_finish_canvas_tool,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="delete_canvas",
        description="Remove a snapshot canvas and its Agenda refresh wake.",
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "canvas_id": {"type": "string"},
                "slug": {"type": "string"},
            },
        },
        handler=_delete_canvas_tool,
    )
)
