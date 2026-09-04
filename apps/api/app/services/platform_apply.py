"""Apply platform changes to domain models and sync canvas overlay."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.integration import IntegrationConnection, McpServer
from app.models.orchestra import Workstream
from app.models.os_graph import ALLOWED_EDGES, OsCanvasNode
from app.models.platform_change import PlatformChange
from app.services.os_graph import create_canvas_edge, create_canvas_node


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "item"


async def sync_entity_to_canvas(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    node_type: str,
    ref_id: UUID,
    label: str | None = None,
    x: float = 200.0,
    y: float = 200.0,
) -> dict[str, Any] | None:
    try:
        return await create_canvas_node(
            session,
            tenant_id,
            node_type=node_type,
            ref_id=ref_id,
            x=x,
            y=y,
            label=label,
        )
    except HTTPException:
        return None


async def apply_agent_change(
    session: AsyncSession, tenant_id: UUID, change_kind: str, after: dict[str, Any], before: dict[str, Any]
) -> dict[str, Any]:
    if change_kind == "delete":
        agent_id = after.get("agent_id") or before.get("agent_id")
        if not agent_id:
            raise HTTPException(status_code=400, detail="agent_id required for delete")
        result = await session.execute(
            select(Agent).where(Agent.id == UUID(str(agent_id)), Agent.tenant_id == tenant_id)
        )
        agent = result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        agent.is_active = False
        agent.runtime_status = "inactive"
        agent.updated_at = datetime.utcnow()
        await session.flush()
        return {"agent_id": str(agent.id), "status": "deactivated"}

    if change_kind == "update":
        agent_id = after.get("agent_id") or before.get("agent_id")
        if not agent_id:
            raise HTTPException(status_code=400, detail="agent_id required for update")
        result = await session.execute(
            select(Agent).where(Agent.id == UUID(str(agent_id)), Agent.tenant_id == tenant_id)
        )
        agent = result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        for field in ("name", "role", "system_prompt", "model", "autonomy_level"):
            if field in after:
                setattr(agent, field, after[field])
        if "tools" in after:
            agent.tools_json = json.dumps(after["tools"])
        if "permission_scopes" in after:
            agent.permission_scopes_json = json.dumps(after["permission_scopes"])
        agent.updated_at = datetime.utcnow()
        await session.flush()
        return {"agent_id": str(agent.id), "status": "updated"}

    name = after.get("name", "New agent")
    role = after.get("role", "assistant")
    agent = Agent(
        tenant_id=tenant_id,
        name=name,
        role=role,
        slug=_slugify(name),
        system_prompt=after.get("system_prompt", ""),
        model=after.get("model", "bokito-ai-3-1"),
        tools_json=json.dumps(after.get("tools", [])),
        permission_scopes_json=json.dumps(after.get("permission_scopes", [])),
    )
    session.add(agent)
    await session.flush()
    canvas = None
    if role in ("orchestrator", "po", "assistant"):
        canvas = await sync_entity_to_canvas(
            session,
            tenant_id,
            node_type="orchestrator" if role == "orchestrator" else "workstream",
            ref_id=agent.id,
            label=name,
            x=float(after.get("x", 200)),
            y=float(after.get("y", 200)),
        )
    return {"agent_id": str(agent.id), "status": "created", "canvas": canvas}


async def apply_workstream_change(
    session: AsyncSession, tenant_id: UUID, change_kind: str, after: dict[str, Any], before: dict[str, Any]
) -> dict[str, Any]:
    if change_kind == "delete":
        ws_id = after.get("workstream_id") or before.get("workstream_id")
        result = await session.execute(
            select(Workstream).where(Workstream.id == UUID(str(ws_id)), Workstream.tenant_id == tenant_id)
        )
        ws = result.scalar_one_or_none()
        if not ws:
            raise HTTPException(status_code=404, detail="Workstream not found")
        ws.enabled = False
        await session.flush()
        return {"workstream_id": str(ws.id), "status": "disabled"}

    if change_kind == "update":
        ws_id = after.get("workstream_id") or before.get("workstream_id")
        result = await session.execute(
            select(Workstream).where(Workstream.id == UUID(str(ws_id)), Workstream.tenant_id == tenant_id)
        )
        ws = result.scalar_one_or_none()
        if not ws:
            raise HTTPException(status_code=404, detail="Workstream not found")
        if "name" in after:
            ws.name = after["name"]
        if "description" in after:
            ws.description = after["description"]
        if "enabled" in after:
            ws.enabled = bool(after["enabled"])
        await session.flush()
        return {"workstream_id": str(ws.id), "status": "updated"}

    name = after.get("name", "Workstream")
    ws = Workstream(
        tenant_id=tenant_id,
        name=name,
        description=after.get("description", ""),
        enabled=after.get("enabled", True),
    )
    session.add(ws)
    await session.flush()
    canvas = await sync_entity_to_canvas(
        session,
        tenant_id,
        node_type="workstream",
        ref_id=ws.id,
        label=name,
        x=float(after.get("x", 400)),
        y=float(after.get("y", 300)),
    )
    return {"workstream_id": str(ws.id), "status": "created", "canvas": canvas}


async def apply_mcp_server_change(
    session: AsyncSession, tenant_id: UUID, change_kind: str, after: dict[str, Any], before: dict[str, Any]
) -> dict[str, Any]:
    if change_kind in ("update", "delete"):
        server_id = after.get("mcp_server_id") or before.get("mcp_server_id")
        result = await session.execute(
            select(McpServer).where(McpServer.id == UUID(str(server_id)), McpServer.tenant_id == tenant_id)
        )
        mcp = result.scalar_one_or_none()
        if not mcp:
            raise HTTPException(status_code=404, detail="MCP server not found")
        if change_kind == "delete":
            mcp.is_active = False
        else:
            if "name" in after:
                mcp.name = after["name"]
            if "server_url" in after:
                mcp.server_url = after["server_url"]
        await session.flush()
        return {"mcp_server_id": str(mcp.id), "status": change_kind}

    name = after.get("name", "MCP server")
    from app.services.integrations_platform import register_mcp_server

    mcp, _conn, _binding = await register_mcp_server(
        session,
        tenant_id,
        name=name,
        server_url=after.get("server_url", ""),
        auth=after.get("auth", {}),
    )
    canvas = await sync_entity_to_canvas(
        session,
        tenant_id,
        node_type="tool",
        ref_id=mcp.id,
        label=name,
    )
    return {"mcp_server_id": str(mcp.id), "status": "created", "canvas": canvas}


async def apply_integration_change(
    session: AsyncSession, tenant_id: UUID, change_kind: str, after: dict[str, Any], before: dict[str, Any]
) -> dict[str, Any]:
    if change_kind in ("update", "delete"):
        conn_id = after.get("integration_id") or before.get("integration_id")
        result = await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == UUID(str(conn_id)),
                IntegrationConnection.tenant_id == tenant_id,
            )
        )
        conn = result.scalar_one_or_none()
        if not conn:
            raise HTTPException(status_code=404, detail="Integration not found")
        if change_kind == "delete":
            conn.status = "inactive"
        else:
            if "display_name" in after:
                conn.display_name = after["display_name"]
            if "status" in after:
                conn.status = after["status"]
        await session.flush()
        return {"integration_id": str(conn.id), "status": change_kind}

    provider = after.get("provider", "custom")
    conn = IntegrationConnection(
        tenant_id=tenant_id,
        provider=provider,
        display_name=after.get("display_name", provider),
        status=after.get("status", "pending"),
        metadata_json=json.dumps(after.get("metadata", {})),
    )
    session.add(conn)
    await session.flush()
    canvas = await sync_entity_to_canvas(
        session,
        tenant_id,
        node_type="tool",
        ref_id=conn.id,
        label=conn.display_name or provider,
    )
    return {"integration_id": str(conn.id), "status": "created", "canvas": canvas}


async def apply_canvas_node_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    node_type = after.get("node_type")
    ref_id = after.get("ref_id")
    if not node_type or not ref_id:
        raise HTTPException(status_code=400, detail="node_type and ref_id required")
    summary = await create_canvas_node(
        session,
        tenant_id,
        node_type=node_type,
        ref_id=UUID(str(ref_id)),
        x=float(after.get("x", 200)),
        y=float(after.get("y", 200)),
        label=after.get("label"),
    )
    return {"canvas_node_id": summary["id"], "status": "created", "node": summary}


async def apply_canvas_edge_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    relation = after.get("relation")
    source_node_id = after.get("source_node_id")
    target_node_id = after.get("target_node_id")
    if not relation or not source_node_id or not target_node_id:
        raise HTTPException(status_code=400, detail="relation, source_node_id, target_node_id required")
    if relation not in ALLOWED_EDGES:
        raise HTTPException(status_code=400, detail=f"Invalid relation: {relation}")

    src = (
        await session.execute(
            select(OsCanvasNode).where(
                OsCanvasNode.id == UUID(str(source_node_id)),
                OsCanvasNode.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    tgt = (
        await session.execute(
            select(OsCanvasNode).where(
                OsCanvasNode.id == UUID(str(target_node_id)),
                OsCanvasNode.tenant_id == tenant_id,
            )
        )
    ).scalar_one_or_none()
    if not src or not tgt:
        raise HTTPException(status_code=404, detail="Canvas node not found")
    expected = ALLOWED_EDGES[relation]
    if src.node_type != expected[0] or tgt.node_type != expected[1]:
        raise HTTPException(status_code=400, detail=f"Invalid edge types for {relation}")

    edge = await create_canvas_edge(
        session,
        tenant_id,
        source_node_id=UUID(str(source_node_id)),
        target_node_id=UUID(str(target_node_id)),
        relation=relation,
    )
    return {"canvas_edge_id": edge["id"], "status": "connected"}


async def _track_run_section_write(
    session: AsyncSession, tenant_id: UUID, run_id: str, section: Any
) -> None:
    """Section written inside a workstream run: status moves to review and the
    run remembers the section so gate approval can promote it to final."""
    from app.models.orchestra import WorkstreamRun

    try:
        run = await session.get(WorkstreamRun, UUID(run_id))
    except ValueError:
        return
    if run is None or run.tenant_id != tenant_id:
        return
    if section.status == "draft":
        now = datetime.utcnow()
        section.status = "review"
        section.status_changed_at = now
        section.status_changed_by_type = "system"
        section.status_changed_by_id = "workstream_run"
        section.updated_at = now
        session.add(section)
    try:
        ctx = json.loads(run.context_json or "{}")
        if not isinstance(ctx, dict):
            ctx = {}
    except json.JSONDecodeError:
        ctx = {}
    written = ctx.get("written_section_ids")
    if not isinstance(written, list):
        written = []
    if str(section.id) not in written:
        written.append(str(section.id))
    ctx["written_section_ids"] = written
    run.context_json = json.dumps(ctx)
    session.add(run)
    await session.flush()


async def apply_workspace_doc_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    from app.services.workspace import get_doc_by_path, upsert_doc, upsert_section

    path = after.get("path")
    content = after.get("content", "")
    if not path:
        raise HTTPException(status_code=400, detail="after_json missing path")
    mode = after.get("mode", "append")
    section = str(after.get("section") or "").strip()
    project_id = UUID(str(after["project_id"])) if after.get("project_id") else None
    agent_id = UUID(str(after["agent_id"])) if after.get("agent_id") else None
    existing = await get_doc_by_path(session, tenant_id, path)
    if section:
        # Section-scoped write: touch exactly one atomic knowledge unit.
        doc = existing or await upsert_doc(
            session,
            tenant_id,
            path=path,
            content="",
            kind=after.get("kind"),
            project_id=project_id,
            agent_id=agent_id,
            created_by_type="agent",
            commit=False,
        )
        row = await upsert_section(
            session,
            tenant_id,
            doc,
            heading=section,
            content=content,
            mode=mode,
            actor_type="agent",
            commit=False,
        )
        run_id = after.get("workstream_run_id")
        if run_id:
            await _track_run_section_write(session, tenant_id, str(run_id), row)
        return {
            "doc_id": str(doc.id),
            "path": doc.path,
            "section_id": str(row.id),
            "section": row.heading,
            "status": "written",
        }
    if existing and mode == "append" and existing.content.strip():
        content = f"{existing.content.rstrip()}\n\n{content}"
    doc = await upsert_doc(
        session,
        tenant_id,
        path=path,
        content=content,
        kind=after.get("kind"),
        project_id=project_id,
        agent_id=agent_id,
        created_by_type="agent",
        commit=False,
    )
    return {"doc_id": str(doc.id), "path": doc.path, "status": "written"}


async def rollback_workspace_doc(
    session: AsyncSession, tenant_id: UUID, before: dict[str, Any], after: dict[str, Any], change_kind: str
) -> dict[str, Any]:
    from app.services.workspace import delete_doc, get_doc_by_path, upsert_doc

    path = after.get("path") or before.get("path")
    if not path:
        return {"status": "noop"}
    if change_kind == "create":
        doc = await get_doc_by_path(session, tenant_id, path)
        if doc:
            await delete_doc(session, tenant_id, doc.id)
            return {"path": path, "status": "removed"}
        return {"status": "noop"}
    if before.get("content") is not None:
        doc = await upsert_doc(
            session,
            tenant_id,
            path=path,
            content=before["content"],
            kind=before.get("kind"),
            created_by_type="agent",
            commit=False,
        )
        return {"doc_id": str(doc.id), "path": path, "status": "restored"}
    return {"status": "noop"}


async def apply_change_to_domain(
    session: AsyncSession, tenant_id: UUID, change: PlatformChange
) -> dict[str, Any]:
    after = json.loads(change.after_json or "{}")
    before = json.loads(change.before_json or "{}")
    rt = change.resource_type
    ck = change.change_kind

    if rt == "workspace_doc":
        return await apply_workspace_doc_change(session, tenant_id, after)
    if rt == "agent":
        return await apply_agent_change(session, tenant_id, ck, after, before)
    if rt == "workstream":
        return await apply_workstream_change(session, tenant_id, ck, after, before)
    if rt == "mcp_server":
        return await apply_mcp_server_change(session, tenant_id, ck, after, before)
    if rt == "integration":
        return await apply_integration_change(session, tenant_id, ck, after, before)
    if rt == "canvas_node":
        return await apply_canvas_node_change(session, tenant_id, after)
    if rt == "canvas_edge":
        return await apply_canvas_edge_change(session, tenant_id, after)
    if rt == "autonomy_posture":
        return await apply_autonomy_posture_change(session, tenant_id, after)
    if rt == "persona_review":
        return await apply_persona_review_change(session, tenant_id, after)
    if rt == "case_type":
        return await apply_case_type_change(session, tenant_id, ck, after, before)
    if rt == "case_type_binding":
        return await apply_case_type_binding_change(session, tenant_id, ck, after, before)
    return {"status": "applied", "resource_type": rt, "payload": after}


async def apply_persona_review_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    """Approving a persona review appends its guidance to persona.md.

    The proposal carries a `proposed_addition` built from the negative
    feedback samples; approval writes it into the doc every agent reads, so
    accepting the review changes real behavior instead of just acknowledging.
    """
    from datetime import datetime as _dt

    from app.services.persona import append_persona_section

    addition = str(after.get("proposed_addition") or "").strip()
    if not addition:
        samples = after.get("samples") or []
        comments = [
            f"- {str(s.get('comment', '')).strip()}"
            for s in samples
            if isinstance(s, dict) and str(s.get("comment", "")).strip()
        ]
        addition = (
            "Recent feedback to account for in replies:\n" + "\n".join(comments)
            if comments
            else f"Reviewed {after.get('negative_count', 0)} negative feedback signal(s)."
        )
    heading = f"Feedback review {_dt.utcnow().strftime('%Y-%m-%d')}"
    await append_persona_section(session, tenant_id, heading=heading, body=addition)
    return {"status": "applied", "resource_type": "persona_review", "doc": "persona.md"}


def _as_uuid(raw: Any) -> UUID | None:
    if not raw:
        return None
    try:
        return UUID(str(raw))
    except (TypeError, ValueError):
        return None


async def apply_case_type_change(
    session: AsyncSession,
    tenant_id: UUID,
    change_kind: str,
    after: dict[str, Any],
    before: dict[str, Any],
) -> dict[str, Any]:
    from app.services.cases import create_case_type, delete_case_type, serialize_case_type, update_case_type

    if change_kind == "delete":
        type_id = _as_uuid(after.get("case_type_id") or before.get("case_type_id"))
        if type_id is None:
            raise HTTPException(status_code=400, detail="case_type_id required for delete")
        await delete_case_type(session, tenant_id, type_id, commit=False)
        return {"case_type_id": str(type_id), "status": "deleted"}

    if change_kind == "update":
        type_id = _as_uuid(after.get("case_type_id") or before.get("case_type_id"))
        if type_id is None:
            raise HTTPException(status_code=400, detail="case_type_id required for update")
        row = await update_case_type(session, tenant_id, type_id, after, commit=False)
        return serialize_case_type(row)

    row = await create_case_type(
        session,
        tenant_id,
        name=str(after.get("name") or "New type"),
        slug=str(after.get("slug") or ""),
        description=str(after.get("description") or ""),
        create_mode=str(after.get("create_mode") or "ask_customer"),
        ask_threshold=int(after.get("ask_threshold") or 6),
        auto_threshold=int(after.get("auto_threshold") or 9),
        requires_verification=bool(after.get("requires_verification") or False),
        allow_project_link=str(after.get("allow_project_link") or "optional"),
        audience=str(after.get("audience") or "both"),
        enabled=after.get("enabled", True),
        sort_order=int(after.get("sort_order") or 0),
        commit=False,
    )
    after["case_type_id"] = str(row.id)
    return serialize_case_type(row)


async def apply_case_type_binding_change(
    session: AsyncSession,
    tenant_id: UUID,
    change_kind: str,
    after: dict[str, Any],
    before: dict[str, Any],
) -> dict[str, Any]:
    from app.services.cases import create_binding, delete_binding, serialize_binding

    if change_kind == "delete":
        binding_id = _as_uuid(after.get("binding_id") or before.get("binding_id"))
        if binding_id is None:
            raise HTTPException(status_code=400, detail="binding_id required for delete")
        await delete_binding(session, tenant_id, binding_id, commit=False)
        return {"binding_id": str(binding_id), "status": "deleted"}

    type_id = _as_uuid(after.get("case_type_id"))
    target_id = _as_uuid(after.get("target_id"))
    if type_id is None or target_id is None:
        raise HTTPException(status_code=400, detail="case_type_id and target_id are required")
    row = await create_binding(
        session,
        tenant_id,
        case_type_id=type_id,
        target_kind=str(after.get("target_kind") or ""),
        target_id=target_id,
        priority=int(after.get("priority") or 0),
        auto_link=bool(after.get("auto_link", True)),
        auto_start_run=bool(after.get("auto_start_run") or False),
        enabled=bool(after.get("enabled", True)),
        commit=False,
    )
    after["binding_id"] = str(row.id)
    return serialize_binding(row)


async def apply_autonomy_posture_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    """Apply a learning-proposed autonomy posture (manual | assisted | autonomous)."""
    from app.dependencies import tenant_settings
    from app.models.auth import Tenant

    posture = str(after.get("posture") or "")
    if posture not in ("manual", "assisted", "autonomous"):
        return {"status": "invalid_posture", "posture": posture}
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    if tenant is None:
        return {"status": "tenant_not_found"}
    settings = tenant_settings(tenant)
    settings["autonomy_posture"] = posture
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    return {"status": "applied", "posture": posture}


async def rollback_change_to_domain(
    session: AsyncSession, tenant_id: UUID, change: PlatformChange
) -> dict[str, Any]:
    before = json.loads(change.before_json or "{}")
    after = json.loads(change.after_json or "{}")
    rt = change.resource_type
    ck = change.change_kind

    if rt == "workspace_doc":
        return await rollback_workspace_doc(session, tenant_id, before, after, ck)
    if rt == "agent" and ck == "create" and after.get("agent_id"):
        return await apply_agent_change(
            session, tenant_id, "delete", {"agent_id": after["agent_id"]}, before
        )
    if rt == "workstream" and ck == "create" and after.get("workstream_id"):
        return await apply_workstream_change(
            session, tenant_id, "delete", {"workstream_id": after["workstream_id"]}, before
        )
    if rt == "agent" and ck == "update" and before:
        return await apply_agent_change(session, tenant_id, "update", before, after)
    if rt == "case_type" and ck == "create" and after.get("case_type_id"):
        return await apply_case_type_change(
            session, tenant_id, "delete", {"case_type_id": after["case_type_id"]}, before
        )
    if rt == "case_type" and ck == "update" and before:
        return await apply_case_type_change(session, tenant_id, "update", before, after)
    if rt == "case_type_binding" and ck == "create" and after.get("binding_id"):
        return await apply_case_type_binding_change(
            session, tenant_id, "delete", {"binding_id": after["binding_id"]}, before
        )
    return {"status": "rollback_unsupported", "resource_type": rt}
