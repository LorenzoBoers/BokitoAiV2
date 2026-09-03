"""Bokito-hosted partner MCP servers.

Partner integrations (KING first) are exposed as normal MCP HTTP endpoints so
marketplace connect uses the same McpServer node as remote vendors. Agents keep
calling module tools (``accounting_*``); operators see exact MCP tool names.
"""

from __future__ import annotations

import json
import secrets
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.integration import McpServer

PARTNER_KING = "king"
SUPPORTED_PARTNERS = frozenset({PARTNER_KING})


def partner_mcp_path(partner_slug: str) -> str:
    return f"/api/mcp/partners/{partner_slug}"


def partner_mcp_url(partner_slug: str) -> str:
    base = get_settings().public_api_url.rstrip("/")
    return f"{base}{partner_mcp_path(partner_slug)}"


def is_partner_mcp_url(url: str) -> str | None:
    """Return partner slug when ``url`` points at a Bokito partner MCP."""
    if not url:
        return None
    marker = "/api/mcp/partners/"
    idx = url.find(marker)
    if idx < 0:
        return None
    rest = url[idx + len(marker) :].strip("/")
    slug = rest.split("/", 1)[0].strip().lower()
    return slug if slug in SUPPORTED_PARTNERS else None


def is_king_mcp_url(url: str) -> bool:
    if url.startswith("native://king-accountancy"):
        return True
    return is_partner_mcp_url(url) == PARTNER_KING


def mint_partner_access_token() -> str:
    return secrets.token_urlsafe(32)


def partner_tools(partner_slug: str) -> list[dict[str, str]]:
    if partner_slug == PARTNER_KING:
        from app.services.king_finance import KING_NATIVE_TOOLS

        return [dict(t) for t in KING_NATIVE_TOOLS]
    raise HTTPException(status_code=404, detail=f"Unknown partner MCP '{partner_slug}'")


def _parse_auth(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}


def _server_matches_partner(server_url: str, partner_slug: str) -> bool:
    if is_partner_mcp_url(server_url) == partner_slug:
        return True
    return partner_slug == PARTNER_KING and server_url.startswith("native://king-accountancy")


async def resolve_partner_server(
    session: AsyncSession,
    partner_slug: str,
    bearer_token: str,
) -> McpServer:
    token = (bearer_token or "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    result = await session.execute(select(McpServer).where(McpServer.is_active.is_(True)))
    for server in result.scalars().all():
        if not _server_matches_partner(server.server_url, partner_slug):
            continue
        auth = _parse_auth(server.auth_json)
        stored = str(auth.get("partner_access_token") or auth.get("bearer_token") or "").strip()
        if stored and secrets.compare_digest(stored, token):
            return server
    raise HTTPException(status_code=401, detail="Invalid or unknown partner MCP token")


async def call_partner_tool(
    partner_slug: str,
    auth: dict[str, Any],
    tool_name: str,
    arguments: dict[str, Any] | None,
) -> dict[str, Any]:
    if partner_slug == PARTNER_KING:
        from app.services.king_finance import call_king_tool, has_king_credentials
        from app.config import get_settings

        if (
            tool_name != "list_companies"
            and not has_king_credentials(auth)
            and not get_settings().is_production
        ):
            return {
                "ok": True,
                "result": {
                    "mock": True,
                    "tool": tool_name,
                    "arguments": arguments or {},
                },
            }
        return await call_king_tool(auth, tool_name, arguments or {})
    raise HTTPException(status_code=404, detail=f"Unknown partner MCP '{partner_slug}'")


async def list_attached_mcp_tools_by_module(
    session: AsyncSession, tenant_id: UUID
) -> dict[str, list[dict[str, Any]]]:
    """Map module slug -> list of {server_name, provider, server_id, tools}."""
    from app.models.integration import IntegrationBinding, IntegrationConnection
    from app.services.module_attach import attached_modules_by_connection

    by_connection = await attached_modules_by_connection(session, tenant_id)
    if not by_connection:
        return {}

    bindings = await session.execute(
        select(IntegrationBinding, IntegrationConnection)
        .join(IntegrationConnection, IntegrationConnection.id == IntegrationBinding.connection_id)
        .where(
            IntegrationBinding.tenant_id == tenant_id,
            IntegrationBinding.binding_type == "mcp_server",
            IntegrationConnection.status == "active",
        )
    )

    out: dict[str, list[dict[str, Any]]] = {}
    for binding, conn in bindings.all():
        modules = by_connection.get(str(conn.id)) or []
        if not modules:
            continue
        config = _parse_auth(binding.config_json)
        server_id = str(config.get("mcp_server_id") or "").strip()
        if not server_id:
            continue
        try:
            sid = UUID(server_id)
        except ValueError:
            continue
        server = await session.get(McpServer, sid)
        if server is None or server.tenant_id != tenant_id:
            continue
        try:
            tools_raw = json.loads(server.tools_json or "[]")
        except (json.JSONDecodeError, TypeError):
            tools_raw = []
        tools: list[dict[str, str]] = []
        if isinstance(tools_raw, list):
            for row in tools_raw:
                if not isinstance(row, dict):
                    continue
                name = str(row.get("name") or "").strip()
                if not name:
                    continue
                tools.append(
                    {
                        "name": name,
                        "description": str(row.get("description") or "").strip(),
                    }
                )
        entry = {
            "server_id": str(server.id),
            "server_name": server.name,
            "provider": conn.provider,
            "server_url": server.server_url,
            "tools_synced_at": (
                server.tools_synced_at.isoformat() if server.tools_synced_at else None
            ),
            "tools": tools,
        }
        for slug in modules:
            out.setdefault(slug, []).append(entry)
    return out
