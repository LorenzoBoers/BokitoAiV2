"""Work dispatch, progress, questions, artifacts, and folders."""

from __future__ import annotations

import logging
from app.core.time import utcnow

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select

from app.tools._common import (

    PROPOSAL_ITEMS_SCHEMA,
)
from app.tools.registry import ToolContext, ToolSpec, register_tool



logger = logging.getLogger(__name__)

async def _create_task(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from datetime import timedelta

    from app.services.agent.style import strip_emoji
    from app.services.orchestration.dispatcher import create_agent_task

    title = strip_emoji(str(tool_input.get("title", ""))) or "Follow up"
    workstream_id = UUID(str(tool_input["workstream_id"])) if tool_input.get("workstream_id") else None
    requested_agent = UUID(str(tool_input["agent_id"])) if tool_input.get("agent_id") else None
    peer = requested_agent and (not ctx.agent or requested_agent != ctx.agent.id)

    # On a conversation without a playbook/peer: a human task on that thread
    # (Agenda). Same AgentTask ledger as agent jobs.
    if ctx.signal_id and not workstream_id and not peer:
        when = utcnow() + timedelta(hours=4)
        task = await create_agent_task(
            ctx.session,
            ctx.tenant_id,
            title=title,
            description=tool_input.get("description", ""),
            signal_id=ctx.signal_id,
            project_id=UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else ctx.project_id,
            created_by=ctx.user_id,
            kind="task",
            origin="conversation",
            assignee_kind="human",
            assignee_user_id=ctx.user_id,
            scheduled_for=when,
            auto_start=False,
        )
        return {
            "kind": "task",
            "task_id": str(task.id),
            "signal_id": str(task.signal_id) if task.signal_id else None,
            "scheduled_for": task.scheduled_for.isoformat() if task.scheduled_for else None,
            "status": task.status,
            "assignee_kind": "human",
        }

    agent_id = requested_agent or (ctx.agent.id if ctx.agent else None)
    task = await create_agent_task(
        ctx.session,
        ctx.tenant_id,
        title=title,
        description=tool_input.get("description", ""),
        agent_id=agent_id,
        project_id=UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else ctx.project_id,
        workstream_id=workstream_id,
        signal_id=ctx.signal_id,
        created_by=ctx.user_id,
        auto_start=tool_input.get("auto_start", True),
    )
    return {
        "kind": "job",
        "task_id": str(task.id),
        "signal_id": str(task.signal_id) if task.signal_id else None,
        "status": task.status,
    }


async def _attach_items(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.proposal_items import resolve_items, stash_attach_items

    items = await resolve_items(
        ctx.session, ctx.tenant_id, tool_input.get("items") if isinstance(tool_input.get("items"), list) else None
    )
    stash_attach_items(ctx.signal_id, items)
    missing = [i for i in items if i.get("missing")]
    result: dict[str, Any] = {"ok": True, "attached": len(items), "items": items}
    if missing:
        result["missing_items"] = [{"type": i["type"], "id": i["id"]} for i in missing]
    return result


register_tool(
    ToolSpec(
        name="attach_items",
        description=(
            "Preferred way to present platform objects in chat: showcase cards under "
            "your last message (with logos for connectors). Call this whenever you "
            "recommend, list, or point at objects — do not use a bullet list instead. "
            "Pass items [{type, id}]. Types: conversation, trash_entry, trigger, file, "
            "image, user, agent, tag, flow, folder, canvas, contact, integration, "
            "marketplace, module, help_doc, knowledge, message. Modules the workspace "
            "has not installed yet are type module + catalog slug (accounting, "
            "banking, investing, documents) — the card matches the marketplace, "
            "including the specialist. Prefer recommend_module when you want them "
            "to install it. Workspace docs from "
            "list_docs are type knowledge with the doc id. Connectors: type marketplace + catalog slug "
            "(github, slack, notion, google_calendar, whatsapp, …). Type integration "
            "only for a connected connection id (falls back to marketplace when not "
            "connected). Remote images: type image with url (https). Name a label "
            "without a leading #. Use propose_action when the operator must choose or approve."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {"items": PROPOSAL_ITEMS_SCHEMA},
            "required": ["items"],
        },
        handler=_attach_items,
        gated=False,
        mutating=False,
        audience="both",
    )
)


async def _update_progress(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.agent.style import strip_emoji

    message = strip_emoji(str(tool_input.get("message") or "").strip())
    if not message:
        return {"error": "message is required"}
    return {"ok": True, "message": message[:240]}


register_tool(
    ToolSpec(
        name="update_progress",
        description=(
            "Post one short English status line in this conversation while you "
            "keep working. Use it only when the turn is taking a while (several "
            "tools or a wait), never as the first action and never when you are "
            "about to finish. The tool writes the message — do not also write "
            "the same line as chat speech. Always English."
        ),
        category="messaging",
        input_schema={
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "One short English line for the operator.",
                }
            },
            "required": ["message"],
        },
        handler=_update_progress,
        gated=False,
        mutating=False,
        audience="operator",
        display_name="Update progress",
    )
)


register_tool(
    ToolSpec(
        name="create_task",
        description=(
            "On a conversation: plan a human task on that thread (Agenda). "
            "Pass workstream_id or a peer agent_id to start a flow/delegation job instead."
        ),
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "agent_id": {"type": "string"},
                "project_id": {"type": "string"},
                "workstream_id": {"type": "string"},
                "auto_start": {"type": "boolean"},
            },
            "required": ["title"],
        },
        handler=_create_task,
    )
)

async def _create_project(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.tools.platform import _platform_change
    from app.services.projects import resolve_folder_ref

    name = str(tool_input.get("name") or "").strip()
    if not name:
        return {"error": "name is required"}
    slug = str(tool_input.get("slug") or name).strip().lower().replace(" ", "-")
    nest_raw = (
        str(tool_input.get("nest_under") or tool_input.get("parent_id") or "").strip() or None
    )
    nest_under: str | None = None
    if nest_raw:
        parent, parent_err = await resolve_folder_ref(ctx.session, ctx.tenant_id, nest_raw)
        if parent_err:
            return {"error": "invalid_nest_under", "message": parent_err}
        if parent is None:
            return {
                "error": "invalid_nest_under",
                "message": "nest_under is not a folder id, slug, or name; call list_folders",
            }
        nest_under = str(parent.id)
    tag_ids = [str(t).strip() for t in (tool_input.get("tag_ids") or []) if str(t).strip()]
    if tool_input.get("tag_id") and not tag_ids:
        tag_ids = [str(tool_input["tag_id"]).strip()]
    tags = [str(t).strip() for t in (tool_input.get("tags") or []) if str(t).strip()]
    if tool_input.get("tag") and not tags and not tag_ids:
        tags = [str(tool_input["tag"]).strip()]
    if not tags and not tag_ids:
        tags = [name.lower().replace(" ", "-")]
    return await _platform_change(
        ctx,
        resource_type="project",
        change_kind="create",
        summary=f"Create folder {name}",
        after={
            "name": name,
            "slug": slug,
            "description": str(tool_input.get("description") or ""),
            "autonomous_scope": str(tool_input.get("autonomous_scope") or "folder"),
            "nest_under": nest_under,
            "tag_ids": tag_ids,
            "tags": tags,
        },
        tool_name="create_folder",
    )


register_tool(
    ToolSpec(
        name="create_folder",
        description=(
            "Propose creating a Folder (named place with optional AND label rules, "
            "conversations, boards, canvas and docs). Goes through Govern. Pass tags or "
            "tag_ids for membership. Optional nest_under / parent_id places it in the "
            "free tree without changing labels."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "slug": {"type": "string"},
                "description": {"type": "string"},
                "autonomous_scope": {"type": "string"},
                "nest_under": {
                    "type": "string",
                    "description": (
                        "Parent folder id from list_folders. Slug or name work when "
                        "unique. parent_id is accepted as an alias."
                    ),
                },
                "parent_id": {
                    "type": "string",
                    "description": "Alias of nest_under.",
                },
                "tags": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Label names in this folder's AND set (created when new)",
                },
                "tag_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Existing label ids in this folder's AND set",
                },
                "tag": {"type": "string", "description": "Single tag name (alias for tags)"},
                "tag_id": {"type": "string", "description": "Single tag id (alias for tag_ids)"},
            },
            "required": ["name"],
        },
        handler=_create_project,
        mutating=True,
        gated=True,
        display_name="Create folder",
    )
)


async def _delete_folder(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Trash a folder (soft-delete). Tags stay; use delete_tag only after no folder uses them."""
    from app.tools.platform import _platform_change
    from app.services.projects import resolve_folder_ref

    raw = (
        str(tool_input.get("id") or tool_input.get("folder_id") or tool_input.get("project_id") or "")
        .strip()
        or str(tool_input.get("slug") or tool_input.get("name") or "").strip()
    )
    if not raw:
        return {
            "error": "missing_folder",
            "message": "Pass id (preferred) or slug/name of the folder to delete.",
            "hint": "Call list_folders and pass the folder id.",
        }
    folder, err = await resolve_folder_ref(ctx.session, ctx.tenant_id, raw)
    if err:
        return {"error": "invalid_folder", "message": err}
    if folder is None:
        return {
            "error": "not_found",
            "message": "Folder not found. Call list_folders and pass the folder id.",
        }
    return await _platform_change(
        ctx,
        resource_type="project",
        change_kind="delete",
        summary=f"Delete folder {folder.name}",
        after={
            "project_id": str(folder.id),
            "confirm_name": folder.name,
            "name": folder.name,
            "slug": folder.slug or "",
        },
        before={
            "project_id": str(folder.id),
            "name": folder.name,
            "slug": folder.slug or "",
        },
        tool_name="delete_folder",
    )


register_tool(
    ToolSpec(
        name="delete_folder",
        description=(
            "Move a Folder to the Bin (soft-delete). Conversations are refiled from "
            "that map; tags stay in the registry. Use this to remove obsolete folders "
            "after a restructure — not delete_tag. Pass the folder id from "
            "list_folders. Goes through Govern when policy asks."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "id": {
                    "type": "string",
                    "description": "Folder id from list_folders (preferred).",
                },
                "folder_id": {"type": "string", "description": "Alias of id."},
                "slug": {"type": "string", "description": "Folder slug when unique."},
                "name": {"type": "string", "description": "Folder name when unique."},
            },
        },
        handler=_delete_folder,
        mutating=True,
        gated=True,
        display_name="Delete folder",
    )
)


async def _dispatch_work(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    """Hand a signal brief to a connected workbench (Cursor / Claude / Devin)."""
    from uuid import UUID as _UUID


    from app.models.integration import IntegrationConnection
    from app.services.workbench import Budget, JobSpec
    from app.services.workbench.gateway import JobLinks, dispatch

    provider = str(tool_input.get("provider") or "cursor")
    if provider == "anthropic":
        provider = "claude_managed"
    repo_url = str(tool_input.get("repo_url") or "").strip()
    if not repo_url:
        return {"error": "repo_url is required"}
    brief = str(tool_input.get("brief") or tool_input.get("goal") or "").strip()
    if not brief:
        return {"error": "brief is required"}

    connection_id = tool_input.get("workbench_connection_id")
    if connection_id:
        conn_id = _UUID(str(connection_id))
    else:
        conn = (
            await ctx.session.execute(
                select(IntegrationConnection).where(
                    IntegrationConnection.tenant_id == ctx.tenant_id,
                    IntegrationConnection.kind == "workbench",
                    IntegrationConnection.provider == provider,
                    IntegrationConnection.status == "active",
                )
            )
        ).scalar_one_or_none()
        if conn is None:
            return {
                "error": (
                    f"No active workbench connection for {provider}. "
                    "Connect it under Settings → Developers → Hand work to a coding tool."
                )
            }
        conn_id = conn.id

    max_minutes = int(tool_input.get("max_minutes") or 60)
    max_cost = tool_input.get("max_cost_cents")
    spec = JobSpec(
        repo_url=repo_url,
        ref=str(tool_input.get("ref") or "main"),
        brief=brief,
        context_packet={
            "signal_id": str(ctx.signal_id) if ctx.signal_id else None,
            "project_id": tool_input.get("project_id"),
            "acceptance": tool_input.get("acceptance"),
        },
        options={
            "create_pull_request": bool(tool_input.get("create_pull_request", True)),
            "max_acu_limit": tool_input.get("max_acu_limit"),
        },
        model=str(tool_input["model"]) if tool_input.get("model") else None,
        mode=str(tool_input.get("mode") or "agent"),
        create_pr=bool(tool_input.get("create_pull_request", True)),
        budget=Budget(
            max_minutes=max_minutes,
            max_cost_cents=int(max_cost) if max_cost is not None else None,
        ),
    )
    links = JobLinks(
        signal_id=ctx.signal_id,
        project_id=_UUID(str(tool_input["project_id"])) if tool_input.get("project_id") else None,
        agent_id=ctx.agent.id if ctx.agent else None,
        decision_id=None,
    )
    try:
        job = await dispatch(
            ctx.session,
            tenant_id=ctx.tenant_id,
            spec=spec,
            connection_id=conn_id,
            links=links,
            approved_by=ctx.user_id,
        )
    except Exception as exc:  # noqa: BLE001 — surface provider errors to the agent
        logger.warning('work tool failed', exc_info=True)
        return {"error": str(exc)}
    return {
        "job_id": str(job.id),
        "provider": job.provider,
        "state": job.state,
        "external_id": job.external_id,
        "external_ids": json.loads(job.external_ids_json or "{}"),
    }


register_tool(
    ToolSpec(
        name="dispatch_work",
        description=(
            "Hand coding work to a connected workbench (Cursor Cloud Agents, Claude Managed "
            "Agents, or Devin). Always asks first. Results come back as thread messages."
        ),
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "provider": {
                    "type": "string",
                    "enum": ["cursor", "claude_managed", "devin", "anthropic"],
                },
                "repo_url": {"type": "string"},
                "ref": {"type": "string"},
                "brief": {"type": "string"},
                "goal": {"type": "string"},
                "project_id": {"type": "string"},
                "workbench_connection_id": {"type": "string"},
                "acceptance": {"type": "string"},
                "create_pull_request": {"type": "boolean"},
                "model": {"type": "string"},
                "mode": {"type": "string", "enum": ["agent", "plan"]},
                "max_minutes": {"type": "integer"},
                "max_cost_cents": {"type": "integer"},
                "max_acu_limit": {"type": "integer"},
            },
            "required": ["repo_url", "brief"],
        },
        handler=_dispatch_work,
        mutating=True,
        gated=True,
        consequential=True,
    )
)


async def _follow_up_work(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench.gateway import follow_up

    job_id = tool_input.get("job_id")
    text = str(tool_input.get("text") or "").strip()
    if not job_id or not text:
        return {"error": "job_id and text are required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    try:
        await follow_up(ctx.session, job, text, actor=ctx.user_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning('work tool failed', exc_info=True)
        return {"error": str(exc)}
    return {"job_id": str(job.id), "state": job.state}


register_tool(
    ToolSpec(
        name="follow_up_work",
        description="Send a follow-up message to a running workbench job.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "job_id": {"type": "string"},
                "text": {"type": "string"},
            },
            "required": ["job_id", "text"],
        },
        handler=_follow_up_work,
        mutating=True,
        gated=True,
    )
)


async def _cancel_work(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench.gateway import cancel

    job_id = tool_input.get("job_id")
    if not job_id:
        return {"error": "job_id is required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    try:
        await cancel(ctx.session, job, actor=ctx.user_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning('work tool failed', exc_info=True)
        return {"error": str(exc)}
    return {"job_id": str(job.id), "state": job.state}


register_tool(
    ToolSpec(
        name="cancel_work",
        description="Stop a running workbench job.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {"job_id": {"type": "string"}},
            "required": ["job_id"],
        },
        handler=_cancel_work,
        mutating=True,
        gated=True,
    )
)


async def _report_progress(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench import NormalizedEvent
    from app.services.workbench.gateway import ingest

    job_id = tool_input.get("job_id") or tool_input.get("job_ref")
    summary = str(tool_input.get("summary") or tool_input.get("text") or "").strip()
    if not job_id or not summary:
        return {"error": "job_id and summary are required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    await ingest(
        ctx.session,
        job,
        [
            NormalizedEvent(
                kind="progress",
                summary=summary,
                external_event_id=f"mcp-progress:{job.id}:{summary[:80]}",
            )
        ],
    )
    await ctx.session.commit()
    return {"ok": True, "state": job.state}


register_tool(
    ToolSpec(
        name="report_progress",
        description="Update the progress line for the workbench job that holds this MCP token.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "summary": {"type": "string"},
                "text": {"type": "string"},
                "job_id": {"type": "string"},
                "job_ref": {"type": "string"},
            },
            "required": ["summary"],
        },
        handler=_report_progress,
        mutating=True,
    )
)


async def _ask_question(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench import NormalizedEvent
    from app.services.workbench.gateway import ingest

    job_id = tool_input.get("job_id") or tool_input.get("job_ref")
    question = str(tool_input.get("question") or tool_input.get("text") or "").strip()
    if not job_id or not question:
        return {"error": "job_id and question are required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    await ingest(
        ctx.session,
        job,
        [
            NormalizedEvent(
                kind="needs_input",
                summary=question,
                external_event_id=f"mcp-ask:{job.id}:{question[:80]}",
            )
        ],
    )
    await ctx.session.commit()
    return {"ok": True, "state": "needs_input"}


register_tool(
    ToolSpec(
        name="ask_question",
        description="Ask the operator a question about the current workbench job (raises a Decision).",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                "text": {"type": "string"},
                "job_id": {"type": "string"},
                "job_ref": {"type": "string"},
            },
            "required": ["question"],
        },
        handler=_ask_question,
        mutating=True,
    )
)


async def _attach_artifact(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.models.workbench import WorkJob
    from app.services.workbench import NormalizedEvent
    from app.services.workbench.gateway import ingest

    job_id = tool_input.get("job_id") or tool_input.get("job_ref")
    if not job_id:
        return {"error": "job_id is required"}
    job = await ctx.session.get(WorkJob, _UUID(str(job_id)))
    if job is None or job.tenant_id != ctx.tenant_id:
        return {"error": "Job not found"}
    artifact = {
        "type": str(tool_input.get("type") or "url"),
        "url": str(tool_input.get("url") or ""),
        "ref": str(tool_input.get("ref") or ""),
        "title": str(tool_input.get("title") or tool_input.get("summary") or "Artifact"),
        "state": tool_input.get("state"),
        "external_id": str(tool_input.get("external_id") or tool_input.get("url") or ""),
    }
    await ingest(
        ctx.session,
        job,
        [
            NormalizedEvent(
                kind="artifact",
                summary=artifact["title"],
                external_event_id=f"mcp-art:{job.id}:{artifact['external_id'] or artifact['title']}",
                payload={"artifact": artifact},
            )
        ],
    )
    await ctx.session.commit()
    return {"ok": True, "artifact": artifact}


register_tool(
    ToolSpec(
        name="attach_artifact",
        description="Attach a PR, branch, or URL artifact to the current workbench job.",
        category="integrations",
        input_schema={
            "type": "object",
            "properties": {
                "type": {"type": "string", "enum": ["pr", "diff", "branch", "log", "summary", "url"]},
                "url": {"type": "string"},
                "ref": {"type": "string"},
                "title": {"type": "string"},
                "summary": {"type": "string"},
                "state": {"type": "string"},
                "external_id": {"type": "string"},
                "job_id": {"type": "string"},
                "job_ref": {"type": "string"},
            },
            "required": ["type"],
        },
        handler=_attach_artifact,
        mutating=True,
    )
)
