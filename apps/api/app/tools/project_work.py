"""Agent tools for conversation-driven project work (category: projects).

Lets agents recognize opportunities and bugs in conversations and turn them
into project queue items, link work to smart-doc sections, and manage section
statuses — all under the tenant's allowance policy. In "ask" mode
create_queue_item renders an inline proposal card in the thread instead of
mutating directly.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models.project import Project
from app.models.signal import Signal
from app.services.work_items import serialize_work_item
from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _resolve_project(ctx: ToolContext, tool_input: dict[str, Any]) -> Project | None:
    """Project from explicit id/slug/name, then the thread's project, then the run's."""
    from app.services.projects import resolve_folder_ref

    raw = str(tool_input.get("folder_id") or tool_input.get("project_id") or "").strip()
    if raw:
        project, _err = await resolve_folder_ref(ctx.session, ctx.tenant_id, raw)
        return project
    if ctx.signal_id:
        signal = (
            await ctx.session.execute(
                select(Signal).where(Signal.id == ctx.signal_id, Signal.tenant_id == ctx.tenant_id)
            )
        ).scalar_one_or_none()
        if signal and signal.project_id:
            result = await ctx.session.execute(
                select(Project).where(
                    Project.id == signal.project_id, Project.tenant_id == ctx.tenant_id
                )
            )
            return result.scalar_one_or_none()
    if ctx.project_id:
        result = await ctx.session.execute(
            select(Project).where(
                Project.id == ctx.project_id, Project.tenant_id == ctx.tenant_id
            )
        )
        return result.scalar_one_or_none()
    return None


async def _list_projects(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.folders import folder_path_label, load_catalog
    from app.services.proposal_items import resolve_items, stash_attach_items

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
    # Cards under the reply — do not rely on the model calling attach_items.
    showcase = await resolve_items(
        ctx.session,
        ctx.tenant_id,
        [{"type": "folder", "id": p["id"]} for p in projects],
    )
    if showcase:
        stash_attach_items(ctx.signal_id, showcase)
    return {"folders": projects, "items": showcase}


async def _create_queue_item(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    project = await _resolve_project(ctx, tool_input)
    if project is None:
        return {
            "error": "No folder found. Pass folder_id (id or slug); use list_folders to see them."
        }
    title = str(tool_input.get("title") or "").strip()
    if not title:
        return {"error": "title is required"}
    kind = str(tool_input.get("kind") or "task")
    body = str(tool_input.get("body") or "")
    priority = str(tool_input.get("priority") or "normal")

    if ctx.mode == "ask":
        # Inline proposal card in the thread; approval executes this tool again.
        from app.tools.executor import execute_tool

        payload = {
            "project_id": str(project.id),
            "kind": kind,
            "title": title,
            "body": body,
            "priority": priority,
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
    project = await _resolve_project(ctx, tool_input)
    if project is None:
        return {"error": "No project found. Pass project_id (id or slug)."}
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
    return {"project": project.slug, "items": compact}


async def _update_queue_item_status(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.project_work import transition_queue_item

    try:
        item_id = UUID(str(tool_input.get("queue_item_id") or ""))
    except ValueError:
        return {"error": "queue_item_id must be a valid id"}
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
    project = await _resolve_project(ctx, tool_input)
    if project is None:
        return {"error": "No project found. Pass project_id (id or slug)."}
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
        "project": project.slug,
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
    project = await _resolve_project(ctx, tool_input)
    if project is None:
        return {"error": "No project found. Pass project_id (id or slug)."}
    from app.services.project_work import list_resources

    return {"project": project.slug, "resources": await list_resources(ctx.session, ctx.tenant_id, project.id)}


async def _propose_project_resource(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    project = await _resolve_project(ctx, tool_input)
    if project is None:
        return {"error": "No project found. Pass project_id (id or slug)."}
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
            "List the tenant's folders (id, slug, tag_ids, tag_names, label, path). "
            "Prefer the folder id as parent_id for create_folder. Results are "
            "showcased as folder cards under your reply — write one short "
            "sentence and chip names inline with [Name](path) using the returned "
            "path (always starts with /folders/…). Do not restate them as a "
            "bullet list after the cards."
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
            "Turn one distinct issue from this chat into project work. Call once "
            "per issue (three bugs → three calls). This chat stays the reporting "
            "thread; each call spawns a child conversation, files it as a ticket "
            "when kind matches an action tag on the project (bug → #bug, feature → "
            "#feature), and showcases that ticket in your reply. Do not use "
            "split_conversation on assistant chats — that tool is for customer "
            "threads only. Under 'ask' policy this renders an inline proposal card."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string", "description": "Project id or slug; omit to use the thread's project."},
                "kind": {"type": "string", "enum": ["feature", "bug", "task", "idea", "risk"]},
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
        description="List a project's queue items with status and linked doc sections.",
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "status": {"type": "string"},
                "kind": {"type": "string"},
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
            "Include impact_summary when finishing an analysis."
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
            },
            "required": ["queue_item_id", "status"],
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
            "legacy only. Get doc ids from list_project_docs or list_docs."
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
        description="List a project's documentation with section statuses and linked queue items.",
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
            "List external resources linked to a project (repo, drive, notion, "
            "vibecode, connection). Connection rows are integrations exclusive "
            "to this project; their connection_id works with set_connection_scope."
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
            "Propose linking an external resource (repo, drive, notion, sheet, "
            "vibecode, site) to a project. Records the slot and reference; the "
            "actual connector is configured later by a human."
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


async def _resolve_canvas_owner(ctx: ToolContext, tool_input: dict[str, Any]) -> tuple[str, Any]:
    from app.services.project_canvas import OWNER_PROJECT, OWNER_TENANT

    kind = str(tool_input.get("owner_kind") or "").strip().lower()
    owner_raw = str(tool_input.get("owner_id") or "").strip()
    if kind == OWNER_TENANT:
        return OWNER_TENANT, ctx.tenant_id
    project = await _resolve_project(ctx, tool_input)
    if project is not None:
        return OWNER_PROJECT, project.id
    if owner_raw and kind == OWNER_PROJECT:
        return OWNER_PROJECT, __import__("uuid").UUID(owner_raw)
    return OWNER_TENANT, ctx.tenant_id


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
        showcase = await _stash_canvas_showcase(ctx, canvas)
        return _canvas_reply(canvas, showcase)
    owner_kind, owner_id = await _resolve_canvas_owner(ctx, tool_input)
    slug = str(tool_input.get("slug") or "main").strip().lower() or "main"
    try:
        canvas = await canvas_svc.get_canvas(
            ctx.session,
            ctx.tenant_id,
            owner_kind=owner_kind,
            owner_id=owner_id,
            slug=slug,
        )
        showcase = await _stash_canvas_showcase(ctx, canvas)
        return _canvas_reply(canvas, showcase)
    except HTTPException:
        listed = await canvas_svc.list_canvases(
            ctx.session, ctx.tenant_id, owner_kind=owner_kind, owner_id=owner_id
        )
        showcase = await _stash_canvas_showcase(ctx, listed)
        return {
            "error": "Canvas not found. Pass canvas_id or slug from this list.",
            "items": showcase or [{"id": i["id"], "slug": i["slug"], "title": i["title"]} for i in listed],
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


async def _update_project_canvas(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    canvas_id = str(tool_input.get("canvas_id") or "").strip()
    slug = str(tool_input.get("slug") or "").strip().lower()
    if not canvas_id and not slug:
        return {
            "error": (
                "Pass canvas_id from create_canvas, list_canvases, or get_folder_canvas. "
                "A change updates that canvas. Do not create another one."
            )
        }
    owner_kind, owner_id = await _resolve_canvas_owner(ctx, tool_input)
    notes = str(tool_input.get("notes") or "").strip()
    source = tool_input.get("source")
    tree = tool_input.get("tree")
    reset = bool(tool_input.get("reset"))
    has_meta = any(
        tool_input.get(key) not in (None, "")
        for key in ("refresh_cadence", "refresh_cron", "managing_agent_id")
    )
    if not reset and source is None and tree is None and not has_meta:
        return {
            "error": "Pass source (bokito/canvas JSX) or tree, or reset=true to clear the canvas."
        }
    after: dict[str, Any] = {
        "owner_kind": owner_kind,
        "owner_id": str(owner_id),
        "project_id": str(owner_id) if owner_kind == "project" else None,
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
    if source is not None:
        after["source"] = str(source)
    if isinstance(tree, dict):
        after["tree"] = tree
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
        before={"owner_kind": owner_kind, "owner_id": str(owner_id), "slug": slug},
        summary=summary,
        tool_name="update_folder_canvas",
    )
    canvas = result.get("canvas") if isinstance(result, dict) else None
    if isinstance(canvas, dict) and canvas.get("id"):
        showcase = await _stash_canvas_showcase(ctx, canvas)
        return _canvas_reply(result, showcase)
    return result


async def _create_canvas_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    owner_kind, owner_id = await _resolve_canvas_owner(ctx, tool_input)
    from uuid import UUID as _UUID

    title = str(tool_input.get("title") or "").strip()
    if not title:
        return {"error": "title is required"}
    named_owner = str(tool_input.get("managing_agent_id") or "").strip()
    if named_owner:
        try:
            _UUID(named_owner)
        except ValueError:
            return {"error": "managing_agent_id must be an agent id"}
        manager = named_owner
    else:
        manager = str(ctx.agent.id) if ctx.agent else None
    after = {
        "owner_kind": owner_kind,
        "owner_id": str(owner_id),
        "project_id": str(owner_id) if owner_kind == "project" else None,
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
    }
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
        showcase = await _stash_canvas_showcase(ctx, canvas)
        reply = _canvas_reply(result, showcase)
        if canvas.get("reused"):
            reply["reused"] = True
            reply["message"] = (
                "A canvas with this title already exists. Call update_folder_canvas "
                "with this canvas_id. Do not call create_canvas again."
            )
        return reply
    return result


async def _delete_canvas_tool(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services import project_canvas as canvas_svc

    canvas_id = str(tool_input.get("canvas_id") or "").strip()
    if not canvas_id:
        owner_kind, owner_id = await _resolve_canvas_owner(ctx, tool_input)
        slug = str(tool_input.get("slug") or "").strip().lower()
        if not slug:
            return {"error": "Pass canvas_id or slug"}
        current = await canvas_svc.get_canvas(
            ctx.session, ctx.tenant_id, owner_kind=owner_kind, owner_id=owner_id, slug=slug
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
    from app.services import project_canvas as canvas_svc

    owner_kind, owner_id = await _resolve_canvas_owner(ctx, tool_input)
    listed = await canvas_svc.list_canvases(
        ctx.session, ctx.tenant_id, owner_kind=owner_kind, owner_id=owner_id
    )
    showcase = await _stash_canvas_showcase(ctx, listed)
    paths = {str(item.get("id")): item.get("path") for item in showcase if isinstance(item, dict)}
    return {
        "owner_kind": owner_kind,
        "owner_id": str(owner_id),
        "canvases": [
            {
                "id": i["id"],
                "slug": i["slug"],
                "title": i["title"],
                "empty": i.get("empty"),
                "path": paths.get(str(i["id"])),
            }
            for i in listed
        ],
        "items": showcase,
    }


register_tool(
    ToolSpec(
        name="list_canvases",
        description=(
            "List snapshot canvases for a project or the workspace Overview. "
            "Pass project_id / owner_kind=project for a project; omit or use "
            "owner_kind=tenant for Overview canvases. Auto-showcases a preview card "
            "for each canvas. Link each path inline in the same sentence."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "owner_kind": {"type": "string", "enum": ["project", "tenant"]},
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
            "Read a snapshot canvas (project or tenant/Overview). Returns bokito/canvas "
            "source and tree. Not live queue/budget data. Pass canvas_id, or owner_kind "
            "+ slug (project_id for a project canvas; omit for the workspace Overview). "
            "Auto-showcases a preview card under your reply. Link the returned path "
            "inline, for example [Title](path)."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "canvas_id": {"type": "string"},
                "project_id": {"type": "string"},
                "owner_kind": {"type": "string", "enum": ["project", "tenant"]},
                "owner_id": {"type": "string"},
                "slug": {"type": "string"},
            },
        },
        handler=_get_project_canvas,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="update_folder_canvas",
        description=(
            "Replace one snapshot canvas, or change its refresh and owner. "
            "Pass canvas_id from create_canvas or list_canvases. A tweak updates "
            "that canvas; it does not create a second one. "
            "Write bokito/canvas JSX in `source` (import only from bokito/canvas) in "
            "the same turn you create a canvas. Props are literals. A const above "
            "the return may hold an object, array, number, or string, and a prop "
            "may use that name. If this tool returns an error, rewrite source and "
            "call it again with the same canvas_id in this turn. Allowed: Stack, Grid, Row, Text, "
            "Heading, Callout, Divider, List, Stat, Table, BarChart, LineChart, Card, "
            "Badge. Embed numbers you just looked up. Omit empty sections. "
            "refresh_cadence is manual, hourly, daily, weekly, monthly, or custom "
            "(then pass refresh_cron). managing_agent_id changes the owner. "
            "Works for project canvases and tenant canvases on Overview. "
            "A preview card is attached when the write applies. Link its path inline."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "canvas_id": {"type": "string"},
                "project_id": {"type": "string"},
                "owner_kind": {"type": "string", "enum": ["project", "tenant"]},
                "slug": {"type": "string"},
                "source": {"type": "string"},
                "tree": {"type": "object"},
                "title": {"type": "string"},
                "notes": {"type": "string"},
                "reset": {"type": "boolean"},
                "refresh_cadence": {
                    "type": "string",
                    "enum": ["manual", "hourly", "daily", "weekly", "monthly", "custom"],
                },
                "refresh_cron": {"type": "string"},
                "managing_agent_id": {"type": "string"},
            },
        },
        handler=_update_project_canvas,
    )
)

register_tool(
    ToolSpec(
        name="create_canvas",
        description=(
            "Create a snapshot canvas under a project or the workspace Overview, "
            "then write its content in the same turn with update_folder_canvas "
            "and the returned canvas_id. Do not stop at an empty canvas. The same "
            "title on that owner returns the existing canvas; update that id "
            "instead of opening a second one. Pass force_new only when the person "
            "explicitly wants another canvas with the same title. You are the "
            "owner unless managing_agent_id names another agent. refresh_cadence "
            "is manual (once), hourly, daily (default), weekly, monthly, or custom "
            "with refresh_cron (five-field cron, UTC). The canvas lives on this "
            "conversation unless new_thread is true (this chat is about something "
            "else — then a new thread owns the canvas and its Agenda repeat). A "
            "person can also add a canvas in the UI. A preview card is attached "
            "when it is created. Link its path inline in the same sentence."
        ),
        category="projects",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "slug": {"type": "string"},
                "project_id": {"type": "string"},
                "owner_kind": {"type": "string", "enum": ["project", "tenant"]},
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
            },
            "required": ["title"],
        },
        handler=_create_canvas_tool,
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
                "project_id": {"type": "string"},
                "owner_kind": {"type": "string", "enum": ["project", "tenant"]},
                "slug": {"type": "string"},
            },
        },
        handler=_delete_canvas_tool,
    )
)
