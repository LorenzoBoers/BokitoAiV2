"""Daily connection health: list the tools of every connection and record the result.

A connection that turns bad (error or needs a new sign-in) becomes an internal
signal for the department domain that has access to it, or All.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import McpServer

logger = logging.getLogger(__name__)

BAD = ("error", "needs_reconnect")


def _health(conn: Any) -> str:
    try:
        meta = json.loads(conn.metadata_json or "{}") if conn is not None else {}
    except json.JSONDecodeError:
        meta = {}
    return str(((meta or {}).get("health") or {}).get("status") or "")


async def _owning_department(session: AsyncSession, tenant_id: UUID, connection_id: UUID) -> UUID | None:
    from app.models.relations import ResourceGrant

    return (
        await session.execute(
            select(ResourceGrant.department_id).where(
                ResourceGrant.tenant_id == tenant_id,
                ResourceGrant.connection_id == connection_id,
                ResourceGrant.principal_kind == "department",
                ResourceGrant.department_id.is_not(None),
            ).limit(1)
        )
    ).scalar_one_or_none()


async def check_server(session: AsyncSession, server: McpServer) -> dict[str, Any]:
    """Test one server; raise an internal signal when it went from fine to bad."""
    from app.services.integrations_platform import test_mcp_server
    from app.services.internal_signals import raise_internal_signal
    from app.services.mcp_remote_client import connection_for_server, record_health

    conn = await connection_for_server(session, server)
    before = _health(conn)
    try:
        result = await test_mcp_server(session, server.tenant_id, server.id)
    except Exception as exc:  # noqa: BLE001 — one broken server must not stop the sweep
        logger.warning("health check failed server=%s: %s", server.id, exc)
        result = {"ok": False, "error": str(exc)}
    recorded = _health(conn)
    after = "ok" if result.get("ok") else recorded if recorded in BAD else "error"
    if conn is not None:
        await record_health(session, server, after, str(result.get("error") or ""))
    if after in BAD and before not in BAD and conn is not None:
        name = conn.display_name or server.name
        reconnect = after == "needs_reconnect"
        body = (
            f"{name} needs to be connected again under Connections. Agents cannot use it until then."
            if reconnect
            else f"{name} does not respond: {str(result.get('error') or 'unknown error')[:300]}"
        )
        await raise_internal_signal(
            session,
            server.tenant_id,
            subject=f"Connection {name} needs attention",
            body=body,
            key=f"connection_health:{conn.id}",
            department_id=conn.department_id
            or await _owning_department(session, server.tenant_id, conn.id),
            labels=[str(conn.provider or "connection")],
            about={"connection_id": str(conn.id), "health": after},
        )
    await session.commit()
    return {"server_id": str(server.id), "before": before, "after": after}


async def check_all(session: AsyncSession, tenant_id: UUID | None = None) -> dict[str, int]:
    query = select(McpServer).where(
        McpServer.is_active.is_(True), McpServer.server_url.not_like("mock://%")
    )
    if tenant_id is not None:
        query = query.where(McpServer.tenant_id == tenant_id)
    checked = bad = 0
    for server in (await session.execute(query)).scalars().all():
        out = await check_server(session, server)
        checked += 1
        bad += int(out["after"] in BAD)
    return {"checked": checked, "bad": bad}
