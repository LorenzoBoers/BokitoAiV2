"""AI OS workspace canvas graph: overlay nodes/edges, auto-seed, CRUD."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.integration import IntegrationConnection, McpServer
from app.models.os_graph import (
    ALLOWED_EDGES,
    OS_EDGE_RELATIONS,
    OS_NODE_TYPES,
    OsCanvasEdge,
    OsCanvasNode,
)
from app.models.project import Project, ProjectWorkstream
from app.services.projects import serialize_po_agent
from app.services.workforce_runtime import role_slug

NODE_W = 200.0
NODE_H = 88.0
COL_GAP = 80.0
ROW_GAP = 120.0


def _validate_edge_relation(source_type: str, target_type: str, relation: str) -> None:
    if relation not in OS_EDGE_RELATIONS:
        raise HTTPException(status_code=400, detail=f"Invalid relation: {relation}")
    allowed = ALLOWED_EDGES.get(relation)
    if not allowed or allowed != (source_type, target_type):
        raise HTTPException(
            status_code=400,
            detail=f"Relation {relation} not allowed between {source_type} and {target_type}",
        )


async def _node_key_exists(
    session: AsyncSession, tenant_id: UUID, node_type: str, ref_id: UUID
) -> OsCanvasNode | None:
    result = await session.execute(
        select(OsCanvasNode).where(
            OsCanvasNode.tenant_id == tenant_id,
            OsCanvasNode.node_type == node_type,
            OsCanvasNode.ref_id == ref_id,
        )
    )
    return result.scalar_one_or_none()


async def ensure_canvas_seeded(session: AsyncSession, tenant_id: UUID) -> None:
    """Idempotent seed from projects, workstreams, repos, orchestrators."""
    existing = await session.execute(
        select(func.count()).select_from(OsCanvasNode).where(OsCanvasNode.tenant_id == tenant_id)
    )
    if int(existing.scalar_one() or 0) > 0:
        return

    projects_result = await session.execute(
        select(Project).where(Project.tenant_id == tenant_id).order_by(Project.updated_at.desc())
    )
    projects = list(projects_result.scalars().all())

    orchestrator_nodes: dict[UUID, OsCanvasNode] = {}
    repo_nodes: dict[UUID, OsCanvasNode] = {}

    # Per project column: orchestrator, workstreams, repo
    col = 0
    for project in projects:
        base_x = 80.0 + col * (NODE_W + COL_GAP * 2)
        orch_y = 180.0

        po_agent: Agent | None = None
        if project.po_agent_id:
            po_result = await session.execute(
                select(Agent).where(Agent.id == project.po_agent_id, Agent.tenant_id == tenant_id)
            )
            po_agent = po_result.scalar_one_or_none()

        if po_agent and po_agent.id not in orchestrator_nodes:
            orch_node = OsCanvasNode(
                tenant_id=tenant_id,
                node_type="orchestrator",
                ref_id=po_agent.id,
                x=base_x,
                y=orch_y,
                label=po_agent.name,
            )
            session.add(orch_node)
            await session.flush()
            orchestrator_nodes[po_agent.id] = orch_node

        ws_result = await session.execute(
            select(ProjectWorkstream)
            .where(
                ProjectWorkstream.project_id == project.id,
                ProjectWorkstream.tenant_id == tenant_id,
            )
            .order_by(ProjectWorkstream.position, ProjectWorkstream.name)
        )
        workstreams = list(ws_result.scalars().all())
        ws_nodes: list[OsCanvasNode] = []
        for wi, ws in enumerate(workstreams):
            ws_node = OsCanvasNode(
                tenant_id=tenant_id,
                node_type="workstream",
                ref_id=ws.id,
                x=base_x + (wi % 2) * (NODE_W + 20),
                y=orch_y + ROW_GAP + (wi // 2) * (NODE_H + 24),
                label=ws.name,
            )
            session.add(ws_node)
            await session.flush()
            ws_nodes.append(ws_node)
            if po_agent and po_agent.id in orchestrator_nodes:
                session.add(
                    OsCanvasEdge(
                        tenant_id=tenant_id,
                        source_node_id=ws_node.id,
                        target_node_id=orchestrator_nodes[po_agent.id].id,
                        relation="routed_by",
                    )
                )

        if project.github_repo_full_name or project.repo_binding_id:
            if project.id not in repo_nodes:
                repo_node = OsCanvasNode(
                    tenant_id=tenant_id,
                    node_type="repo",
                    ref_id=project.id,
                    x=base_x,
                    y=orch_y + ROW_GAP * 2 + len(workstreams) * 30,
                    label=project.github_repo_full_name or project.name,
                )
                session.add(repo_node)
                await session.flush()
                repo_nodes[project.id] = repo_node
                for ws_node in ws_nodes:
                    session.add(
                        OsCanvasEdge(
                            tenant_id=tenant_id,
                            source_node_id=ws_node.id,
                            target_node_id=repo_node.id,
                            relation="uses_repo",
                        )
                    )

        col += 1

    # Seed integration connections as tool nodes
    tools_result = await session.execute(
        select(IntegrationConnection).where(IntegrationConnection.tenant_id == tenant_id)
    )
    tools = list(tools_result.scalars().all())
    mcp_result = await session.execute(select(McpServer).where(McpServer.tenant_id == tenant_id))
    mcps = list(mcp_result.scalars().all())

    tool_y = 520.0
    for ti, conn in enumerate(tools):
        tool_node = OsCanvasNode(
            tenant_id=tenant_id,
            node_type="tool",
            ref_id=conn.id,
            x=80.0 + ti * (NODE_W + COL_GAP),
            y=tool_y,
            label=conn.display_name or conn.provider,
        )
        session.add(tool_node)
        await session.flush()

    for mi, mcp in enumerate(mcps):
        tool_node = OsCanvasNode(
            tenant_id=tenant_id,
            node_type="tool",
            ref_id=mcp.id,
            x=80.0 + (len(tools) + mi) * (NODE_W + COL_GAP),
            y=tool_y + ROW_GAP,
            label=mcp.name,
        )
        session.add(tool_node)
        await session.flush()

    await session.commit()


async def _resolve_node_summary(
    session: AsyncSession, tenant_id: UUID, node: OsCanvasNode
) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": str(node.id),
        "node_type": node.node_type,
        "ref_id": str(node.ref_id),
        "x": node.x,
        "y": node.y,
        "label": node.label,
    }

    if node.node_type == "orchestrator":
        result = await session.execute(
            select(Agent).where(Agent.id == node.ref_id, Agent.tenant_id == tenant_id)
        )
        agent = result.scalar_one_or_none()
        base["title"] = agent.name if agent else node.label or "Orchestrator"
        base["subtitle"] = role_slug(agent) if agent else "orchestrator"
        base["status"] = (agent.runtime_status if agent else "unknown") or "standby"
        base["href"] = f"/agents/{node.ref_id}" if agent else None
        return base

    if node.node_type == "workstream":
        result = await session.execute(
            select(ProjectWorkstream).where(
                ProjectWorkstream.id == node.ref_id,
                ProjectWorkstream.tenant_id == tenant_id,
            )
        )
        ws = result.scalar_one_or_none()
        project_id = str(ws.project_id) if ws else None
        base["title"] = ws.name if ws else node.label or "Workstream"
        base["subtitle"] = ws.slug if ws else ""
        base["status"] = ws.status if ws else "draft"
        base["href"] = (
            f"/project/{project_id}/overview?stream={ws.slug}" if ws and project_id else None
        )
        base["project_id"] = project_id
        return base

    if node.node_type == "repo":
        result = await session.execute(
            select(Project).where(Project.id == node.ref_id, Project.tenant_id == tenant_id)
        )
        project = result.scalar_one_or_none()
        base["title"] = node.label or "Source"
        base["subtitle"] = project.github_repo_full_name if project else ""
        base["status"] = (
            project.repo_index_status
            if project and project.repo_index_status
            else ("ready" if project and project.github_repo_full_name else "none")
        )
        base["href"] = f"/project/{node.ref_id}/settings" if project else None
        base["project_id"] = str(node.ref_id)
        return base

    if node.node_type == "tool":
        conn_result = await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == node.ref_id,
                IntegrationConnection.tenant_id == tenant_id,
            )
        )
        conn = conn_result.scalar_one_or_none()
        if conn:
            base["title"] = node.label or conn.display_name or conn.provider
            base["subtitle"] = conn.provider
            base["status"] = conn.status
            base["href"] = "/integrations/connected"
            return base
        mcp_result = await session.execute(
            select(McpServer).where(McpServer.id == node.ref_id, McpServer.tenant_id == tenant_id)
        )
        mcp = mcp_result.scalar_one_or_none()
        base["title"] = node.label or (mcp.name if mcp else "Tool")
        base["subtitle"] = "MCP server" if mcp else ""
        base["status"] = "active" if mcp and mcp.is_active else "inactive"
        base["href"] = "/integrations/connected"
        return base

    base["title"] = node.label or node.node_type
    base["subtitle"] = ""
    base["status"] = "unknown"
    base["href"] = None
    return base


async def build_canvas_graph(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    await ensure_canvas_seeded(session, tenant_id)

    nodes_result = await session.execute(
        select(OsCanvasNode).where(OsCanvasNode.tenant_id == tenant_id)
    )
    canvas_nodes = list(nodes_result.scalars().all())

    edges_result = await session.execute(
        select(OsCanvasEdge).where(OsCanvasEdge.tenant_id == tenant_id)
    )
    canvas_edges = list(edges_result.scalars().all())

    nodes: list[dict[str, Any]] = []
    for node in canvas_nodes:
        summary = await _resolve_node_summary(session, tenant_id, node)
        nodes.append(summary)

    node_type_by_id = {n.id: n.node_type for n in canvas_nodes}

    edges = [
        {
            "id": str(e.id),
            "source_node_id": str(e.source_node_id),
            "target_node_id": str(e.target_node_id),
            "relation": e.relation,
            "source_type": node_type_by_id.get(e.source_node_id),
            "target_type": node_type_by_id.get(e.target_node_id),
        }
        for e in canvas_edges
    ]

    return {"nodes": nodes, "edges": edges}


async def create_canvas_node(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    node_type: str,
    ref_id: UUID,
    x: float = 200.0,
    y: float = 200.0,
    label: str | None = None,
) -> dict[str, Any]:
    if node_type not in OS_NODE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid node_type: {node_type}")

    existing = await _node_key_exists(session, tenant_id, node_type, ref_id)
    if existing:
        summary = await _resolve_node_summary(session, tenant_id, existing)
        return summary

    node = OsCanvasNode(
        tenant_id=tenant_id,
        node_type=node_type,
        ref_id=ref_id,
        x=x,
        y=y,
        label=label,
    )
    session.add(node)
    await session.commit()
    await session.refresh(node)
    return await _resolve_node_summary(session, tenant_id, node)


async def patch_canvas_node(
    session: AsyncSession,
    tenant_id: UUID,
    node_id: UUID,
    *,
    x: float | None = None,
    y: float | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    result = await session.execute(
        select(OsCanvasNode).where(OsCanvasNode.id == node_id, OsCanvasNode.tenant_id == tenant_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Canvas node not found")
    if x is not None:
        node.x = x
    if y is not None:
        node.y = y
    if label is not None:
        node.label = label
    from datetime import datetime

    node.updated_at = datetime.utcnow()
    session.add(node)
    await session.commit()
    await session.refresh(node)
    return await _resolve_node_summary(session, tenant_id, node)


async def delete_canvas_node(session: AsyncSession, tenant_id: UUID, node_id: UUID) -> None:
    result = await session.execute(
        select(OsCanvasNode).where(OsCanvasNode.id == node_id, OsCanvasNode.tenant_id == tenant_id)
    )
    node = result.scalar_one_or_none()
    if not node:
        raise HTTPException(status_code=404, detail="Canvas node not found")

    edges_result = await session.execute(
        select(OsCanvasEdge).where(
            OsCanvasEdge.tenant_id == tenant_id,
            (OsCanvasEdge.source_node_id == node_id) | (OsCanvasEdge.target_node_id == node_id),
        )
    )
    for edge in edges_result.scalars().all():
        await session.delete(edge)
    await session.delete(node)
    await session.commit()


async def create_canvas_edge(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    source_node_id: UUID,
    target_node_id: UUID,
    relation: str,
) -> dict[str, Any]:
    if source_node_id == target_node_id:
        raise HTTPException(status_code=400, detail="Cannot connect node to itself")

    src_result = await session.execute(
        select(OsCanvasNode).where(
            OsCanvasNode.id == source_node_id, OsCanvasNode.tenant_id == tenant_id
        )
    )
    src = src_result.scalar_one_or_none()
    tgt_result = await session.execute(
        select(OsCanvasNode).where(
            OsCanvasNode.id == target_node_id, OsCanvasNode.tenant_id == tenant_id
        )
    )
    tgt = tgt_result.scalar_one_or_none()
    if not src or not tgt:
        raise HTTPException(status_code=404, detail="Source or target node not found")

    _validate_edge_relation(src.node_type, tgt.node_type, relation)

    dup = await session.execute(
        select(OsCanvasEdge).where(
            OsCanvasEdge.tenant_id == tenant_id,
            OsCanvasEdge.source_node_id == source_node_id,
            OsCanvasEdge.target_node_id == target_node_id,
            OsCanvasEdge.relation == relation,
        )
    )
    if dup.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Edge already exists")

    edge = OsCanvasEdge(
        tenant_id=tenant_id,
        source_node_id=source_node_id,
        target_node_id=target_node_id,
        relation=relation,
    )
    session.add(edge)
    await session.commit()
    await session.refresh(edge)
    return {
        "id": str(edge.id),
        "source_node_id": str(edge.source_node_id),
        "target_node_id": str(edge.target_node_id),
        "relation": edge.relation,
        "source_type": src.node_type,
        "target_type": tgt.node_type,
    }


async def delete_canvas_edge(session: AsyncSession, tenant_id: UUID, edge_id: UUID) -> None:
    result = await session.execute(
        select(OsCanvasEdge).where(OsCanvasEdge.id == edge_id, OsCanvasEdge.tenant_id == tenant_id)
    )
    edge = result.scalar_one_or_none()
    if not edge:
        raise HTTPException(status_code=404, detail="Edge not found")
    await session.delete(edge)
    await session.commit()


# Legacy aggregators kept for backward compatibility during transition
async def build_workspace_graph(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    """Deprecated shape; prefer build_canvas_graph."""
    from app.models.agent import AgentRun
    from app.models.notification import DecisionRequest

    graph = await build_canvas_graph(session, tenant_id)
    projects_result = await session.execute(
        select(Project).where(Project.tenant_id == tenant_id).order_by(Project.updated_at.desc())
    )
    projects = list(projects_result.scalars().all())
    project_nodes: list[dict[str, Any]] = []
    for project in projects:
        po_agent = None
        if project.po_agent_id:
            po_result = await session.execute(
                select(Agent).where(Agent.id == project.po_agent_id, Agent.tenant_id == tenant_id)
            )
            po_agent = po_result.scalar_one_or_none()
        ws_count = await session.execute(
            select(func.count())
            .select_from(ProjectWorkstream)
            .where(ProjectWorkstream.project_id == project.id)
        )
        pending = await session.execute(
            select(func.count())
            .select_from(DecisionRequest)
            .where(
                DecisionRequest.tenant_id == tenant_id,
                DecisionRequest.project_id == project.id,
                DecisionRequest.status == "awaiting_human",
            )
        )
        running = await session.execute(
            select(func.count())
            .select_from(AgentRun)
            .where(
                AgentRun.tenant_id == tenant_id,
                AgentRun.project_id == project.id,
                AgentRun.status == "running",
            )
        )
        project_nodes.append(
            {
                "id": str(project.id),
                "name": project.name,
                "slug": project.slug,
                "po_agent": serialize_po_agent(po_agent),
                "workstream_count": int(ws_count.scalar_one() or 0),
                "repo_status": project.repo_index_status
                or ("none" if not project.github_repo_full_name else "ready"),
                "repo_full_name": project.github_repo_full_name,
                "running_runs": int(running.scalar_one() or 0),
                "pending_decisions": int(pending.scalar_one() or 0),
                "has_orchestrator": po_agent is not None,
            }
        )

    orchestra_result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant_id, Agent.role == "orchestra").limit(1)
    )
    orchestra_agent = orchestra_result.scalar_one_or_none()
    from app.models.workspace import WorkspaceDoc

    doc_count_result = await session.execute(
        select(func.count()).select_from(WorkspaceDoc).where(WorkspaceDoc.tenant_id == tenant_id)
    )
    doc_count = int(doc_count_result.scalar_one() or 0)

    return {
        **graph,
        "orchestra": {
            "present": orchestra_agent is not None,
            "agent": serialize_po_agent(orchestra_agent) if orchestra_agent else None,
            "href": "/orchestra",
        },
        "workspace": {
            "present": doc_count > 0,
            "doc_count": doc_count,
            "href": "/knowledge",
        },
        "projects": project_nodes,
        "backbone": {
            "running_runs": 0,
            "pending_decisions": 0,
            "active_agents": 0,
            "project_count": len(project_nodes),
        },
    }


async def build_project_graph(
    session: AsyncSession, tenant_id: UUID, project_id: UUID
) -> dict[str, Any]:
    """Deprecated; redirect clients to workspace canvas graph."""
    from app.services.projects import get_project_row

    project, po_agent = await get_project_row(session, tenant_id, project_id)
    graph = await build_canvas_graph(session, tenant_id)
    return {
        **graph,
        "project": {"id": str(project.id), "name": project.name, "slug": project.slug},
        "orchestrator": {
            "present": po_agent is not None,
            "agent": serialize_po_agent(po_agent),
            "href": f"/project/{project_id}/orchestrator",
        },
    }
