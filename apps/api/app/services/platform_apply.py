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
        model=after.get("model", "claude-sonnet-4-20250514"),
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
    mcp = McpServer(
        tenant_id=tenant_id,
        name=name,
        server_url=after.get("server_url", ""),
        auth_json=json.dumps(after.get("auth", {})),
    )
    session.add(mcp)
    await session.flush()
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


async def apply_workspace_doc_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    from app.services.workspace import get_doc_by_path, upsert_doc

    path = after.get("path")
    content = after.get("content", "")
    if not path:
        raise HTTPException(status_code=400, detail="after_json missing path")
    mode = after.get("mode", "append")
    existing = await get_doc_by_path(session, tenant_id, path)
    if existing and mode == "append" and existing.content.strip():
        content = f"{existing.content.rstrip()}\n\n{content}"
    doc = await upsert_doc(
        session,
        tenant_id,
        path=path,
        content=content,
        kind=after.get("kind"),
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
    return {"status": "applied", "resource_type": rt, "payload": after}


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
    return {"status": "rollback_unsupported", "resource_type": rt}
