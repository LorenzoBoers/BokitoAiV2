"""Agent tools for conversation-driven project work (category: projects).

Lets agents recognize opportunities and bugs in conversations and turn them
into project queue items, link work to smart-doc sections, and manage section
statuses — all under the tenant's allowance policy. In "ask" mode
create_queue_item renders an inline proposal card in the thread instead of
mutating directly.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.models.project import Project
from app.models.signal import Signal
from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _resolve_project(ctx: ToolContext, tool_input: dict[str, Any]) -> Project | None:
    """Project from explicit id/slug, then the thread's project, then the run's."""
    raw = str(tool_input.get("project_id") or "").strip()
    if raw:
        try:
            project_id = UUID(raw)
            result = await ctx.session.execute(
                select(Project).where(Project.id == project_id, Project.tenant_id == ctx.tenant_id)
            )
        except ValueError:
            result = await ctx.session.execute(
                select(Project).where(Project.slug == raw, Project.tenant_id == ctx.tenant_id)
            )
        return result.scalar_one_or_none()
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
    result = await ctx.session.execute(
        select(Project).where(Project.tenant_id == ctx.tenant_id).order_by(Project.updated_at.desc())
    )
    return {
        "projects": [
            {
                "id": str(p.id),
                "name": p.name,
                "slug": p.slug,
                "description": (p.description or "")[:200],
                "autonomous_mode": p.autonomous_mode,
            }
            for p in result.scalars().all()
        ]
    }


async def _create_queue_item(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    project = await _resolve_project(ctx, tool_input)
    if project is None:
        return {
            "error": "No project found. Pass project_id (id or slug); use list_projects to see them."
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
                    },
                    {
                        "id": "always_auto",
                        "label": "Always allow",
                        "action_type": "create_queue_item",
                        "payload": payload,
                        "always_auto": True,
                    },
                    {"id": "reject", "label": "Dismiss", "action_type": "reject"},
                ],
            },
            signal_id=ctx.signal_id,
            agent=ctx.agent,
            run_id=ctx.run_id,
            trust=ctx.trust,
        )

    from app.services.project_work import create_queue_item, serialize_queue_item

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
    return {"queue_item": serialize_queue_item(item), "status": "created"}


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
    from app.services.project_work import serialize_queue_item, transition_queue_item

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
    return {"queue_item": serialize_queue_item(item)}


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
        name="list_projects",
        description="List the tenant's projects (id, slug, description) to pick the right one.",
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
            "Add an implementation request (feature, bug, task, idea, risk) to a "
            "project's queue. Use this when a conversation reveals an opportunity, "
            "bug, or request that the project should pick up. Under 'ask' policy "
            "this renders an inline proposal card for the human."
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
        name="list_project_docs",
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
        name="list_project_resources",
        description="List external resources linked to a project (repo, drive, notion, vibecode).",
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
        name="propose_project_resource",
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
