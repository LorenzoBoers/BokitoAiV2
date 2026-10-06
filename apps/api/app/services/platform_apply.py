"""Apply platform changes to domain models.

The OS overlay graph is retired; applying agent/playbook/connection changes
no longer writes `os_canvas_*` rows.
"""

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
from app.models.platform_change import PlatformChange
from app.services.agent_rules import parse_autonomy_level
from app.services.os_graph import OS_GRAPH_RETIRED


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
    """No-op: the OS overlay is gone. Callers may still pass canvas=None."""
    del session, tenant_id, node_type, ref_id, label, x, y
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
        agent.runtime_status = "standby"
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
        if after.get("restore") or (
            after.get("kind") == "company" and agent.kind == "archived"
        ):
            # Managed restore (or explicit un-archive): provenance stays intact.
            agent.kind = "company"
            agent.is_active = True
            agent.runtime_status = "standby"
        for field in ("name", "role", "system_prompt", "model", "autonomy_level", "slug"):
            if field in after:
                setattr(agent, field, after[field])
        if "is_active" in after and not after.get("restore"):
            agent.is_active = bool(after["is_active"])
        if "tools" in after:
            agent.tools_json = json.dumps(after["tools"])
        if "permission_scopes" in after:
            agent.permission_scopes_json = json.dumps(after["permission_scopes"])
        agent.updated_at = datetime.utcnow()
        await session.flush()
        restored = bool(after.get("restore")) or (
            before.get("kind") == "archived" and agent.kind == "company"
        )
        return {"agent_id": str(agent.id), "status": "restored" if restored else "updated"}

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
        if "autonomy_level" in after:
            ws.autonomy_level = parse_autonomy_level(after["autonomy_level"])
        # steps retired — stages-only playbooks
        await session.flush()
        return {
            "workstream_id": str(ws.id),
            "status": "updated",
            "stages_count": None,
        }

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
    return {
        "workstream_id": str(ws.id),
        "status": "created",
        "stages_count": 0,
        "canvas": canvas,
    }


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
    del session, tenant_id, after
    return dict(OS_GRAPH_RETIRED)


async def apply_canvas_edge_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    del session, tenant_id, after
    return dict(OS_GRAPH_RETIRED)


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
    if rt == "ai_handling_channel":
        return await apply_ai_handling_channel_change(session, tenant_id, after)
    if rt == "persona_review":
        return await apply_persona_review_change(session, tenant_id, after)
    if rt == "category":
        return await apply_category_change(session, tenant_id, ck, after, before)
    if rt == "project":
        return await apply_project_change(session, tenant_id, ck, after, before)
    if rt == "project_canvas":
        from app.services.project_canvas import apply_canvas_document

        return await apply_canvas_document(session, tenant_id, after, change_kind=ck)
    if rt == "trigger":
        return await apply_trigger_change(session, tenant_id, ck, after, before)
    if rt == "agent_rule":
        return await apply_agent_rule_change(session, tenant_id, after)
    if rt == "routing_rule":
        return await apply_routing_rule_change(session, tenant_id, after)
    return {"status": "applied", "resource_type": rt, "payload": after}


async def apply_routing_rule_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    """Questions on ``topic`` go to ``user_id`` from now on."""
    from app.models.auth import Tenant
    from app.services.routing_learning import add_routing_rule

    tenant = await session.get(Tenant, tenant_id)
    topic = str(after.get("topic") or "")
    user_id = _as_uuid(after.get("user_id"))
    if tenant is None or not topic or user_id is None:
        return {"status": "invalid"}
    rule = add_routing_rule(tenant, topic, str(user_id))
    session.add(tenant)
    return {"status": "applied", "rule": rule}


async def apply_agent_rule_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    """Add an accepted exception rule to one agent, or to every agent when ``agent_id`` is empty."""
    from app.models.agent import Agent
    from app.models.auth import Tenant
    from app.services.agent_rules import add_rule

    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        return {"status": "tenant_not_found"}
    agent = None
    agent_id = _as_uuid(after.get("agent_id"))
    if agent_id is not None:
        agent = await session.get(Agent, agent_id)
        if agent is None or agent.tenant_id != tenant_id:
            return {"status": "agent_not_found"}
    rule = add_rule(tenant, agent, dict(after.get("rule") or {}))
    session.add(agent if agent is not None else tenant)
    return {"status": "applied", "rule": rule, "agent_id": str(agent.id) if agent else None}


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


async def apply_category_change(
    session: AsyncSession,
    tenant_id: UUID,
    change_kind: str,
    after: dict[str, Any],
    before: dict[str, Any],
) -> dict[str, Any]:
    """Create, edit or remove a category (a hashtag with a playbook)."""
    from app.models.orchestra import Workstream
    from app.models.signal import SignalTag
    from app.services.signal_tags import delete_tag, normalize_tag, set_tag_playbook
    from app.services.tickets import apply_category_config, serialize_category

    if change_kind == "delete":
        tag_id = _as_uuid(after.get("tag_id") or before.get("tag_id"))
        if tag_id is None:
            raise HTTPException(status_code=400, detail="tag_id required for delete")
        try:
            await delete_tag(session, tenant_id, tag_id, commit=False)
        except LookupError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"tag_id": str(tag_id), "status": "deleted"}

    if change_kind == "update":
        tag_id = _as_uuid(after.get("tag_id") or before.get("tag_id"))
        row = await session.get(SignalTag, tag_id) if tag_id else None
        if row is None or row.tenant_id != tenant_id:
            raise HTTPException(status_code=404, detail="Category not found")
        if "workstream_id" in after:
            try:
                await set_tag_playbook(
                    session, tenant_id, row.id, workstream_id=_as_uuid(after.get("workstream_id")), commit=False
                )
            except LookupError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
        apply_category_config(row, after)
        if after.get("description") is not None:
            row.description = str(after["description"]).strip()[:300]
        if after.get("show_in_nav") is not None:
            row.show_in_nav = bool(after["show_in_nav"])
        session.add(row)
        await session.flush()
        return serialize_category(row)

    name = normalize_tag(str(after.get("name") or ""))
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    row = (
        await session.execute(
            select(SignalTag).where(SignalTag.tenant_id == tenant_id, SignalTag.name == name)
        )
    ).scalar_one_or_none()
    if row is None:
        row = SignalTag(tenant_id=tenant_id, name=name)
        session.add(row)
    workstream_id = _as_uuid(after.get("workstream_id"))
    if workstream_id is None:
        ws = Workstream(tenant_id=tenant_id, name=name.replace("-", " ").capitalize())
        session.add(ws)
        await session.flush()
        workstream_id = ws.id
    else:
        ws = await session.get(Workstream, workstream_id)
        if ws is None or ws.tenant_id != tenant_id:
            raise HTTPException(status_code=404, detail="Playbook not found")
    row.workstream_id = workstream_id
    row.show_in_nav = True
    row.pinned = False
    if after.get("description"):
        row.description = str(after["description"]).strip()[:300]
    apply_category_config(row, after)
    session.add(row)
    await session.flush()
    after["tag_id"] = str(row.id)
    return serialize_category(row)


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
    # Posture change resets explicit per-category overrides to the preset.
    settings.pop("tool_allowances", None)
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    return {"status": "applied", "posture": posture}


async def apply_ai_handling_channel_change(
    session: AsyncSession, tenant_id: UUID, after: dict[str, Any]
) -> dict[str, Any]:
    """Apply a learning-proposed channel AI handling (earned autonomy)."""
    from app.models.channel import ChannelAccount
    from app.services.ai_handling import set_account_mode, normalize_mode

    mode = normalize_mode(after.get("mode"))
    try:
        account_id = UUID(str(after.get("channel_account_id") or ""))
    except ValueError:
        return {"status": "invalid_channel"}
    account = await session.get(ChannelAccount, account_id)
    if account is None or account.tenant_id != tenant_id or mode is None:
        return {"status": "invalid_channel"}
    set_account_mode(account, mode)
    session.add(account)
    return {"status": "applied", "channel_account_id": str(account_id), "mode": mode}


async def apply_project_change(
    session: AsyncSession,
    tenant_id: UUID,
    change_kind: str,
    after: dict[str, Any],
    before: dict[str, Any],
) -> dict[str, Any]:
    from app.services.projects import create_project, serialize_project

    if change_kind != "create":
        return {"status": "unsupported", "change_kind": change_kind}
    name = str(after.get("name") or "").strip()
    if not name:
        return {"status": "invalid", "error": "name required"}
    slug = str(after.get("slug") or name).strip().lower().replace(" ", "-")
    description = str(after.get("description") or "")
    autonomous_scope = str(after.get("autonomous_scope") or "project")
    try:
        row = await create_project(
            session,
            tenant_id,
            name=name,
            slug=slug,
            autonomous_scope=autonomous_scope,
            description=description,
        )
    except Exception as exc:  # noqa: BLE001 — surface to Govern
        return {"status": "error", "error": str(exc)}
    after["project_id"] = row.get("id") if isinstance(row, dict) else None
    return row if isinstance(row, dict) else {"status": "applied", "project": serialize_project(row)}


async def apply_trigger_change(
    session: AsyncSession,
    tenant_id: UUID,
    change_kind: str,
    after: dict[str, Any],
    before: dict[str, Any],
) -> dict[str, Any]:
    from datetime import datetime
    from uuid import UUID as _UUID

    from app.services.triggers import create_trigger, serialize_trigger

    if change_kind not in ("create", "update"):
        return {"status": "unsupported", "change_kind": change_kind}
    name = str(after.get("name") or "Wake").strip()
    instructions = str(after.get("instructions") or "").strip()
    if not instructions:
        return {"status": "invalid", "error": "instructions required"}
    cron_expr = str(after.get("cron") or "") or ""
    interval = after.get("every_minutes")
    at_raw = after.get("at")
    run_at: datetime | None = None
    if at_raw:
        try:
            run_at = datetime.fromisoformat(str(at_raw).replace("Z", "+00:00")).replace(tzinfo=None)
        except ValueError:
            return {"status": "invalid", "error": "at must be ISO datetime"}
    if cron_expr:
        kind = "cron"
    elif interval:
        kind = "interval"
    elif run_at:
        kind = "once"
    else:
        return {"status": "invalid", "error": "pass at, cron, or every_minutes"}
    agent_id = None
    if after.get("agent_id"):
        try:
            agent_id = _UUID(str(after["agent_id"]))
        except ValueError:
            return {"status": "invalid", "error": "agent_id must be a UUID"}
    try:
        trigger = await create_trigger(
            session,
            tenant_id,
            name=name,
            kind=kind,
            cron_expr=cron_expr,
            interval_minutes=int(interval) if interval else 0,
            agent_id=agent_id,
            instructions=instructions,
            run_at=run_at,
        )
    except Exception as exc:  # noqa: BLE001
        return {"status": "error", "error": str(exc)}
    after["trigger_id"] = str(getattr(trigger, "id", "") or "")
    return serialize_trigger(trigger)


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
    if rt == "category" and ck == "update" and before:
        return await apply_category_change(session, tenant_id, "update", before, after)
    return {"status": "rollback_unsupported", "resource_type": rt}
