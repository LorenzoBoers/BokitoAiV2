"""Module registration listings: connections + defaults for the module home."""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection, McpServer
from app.modules.catalog import (
    MODULE_BY_SLUG,
    active_module_connections,
    get_module_prefs,
    update_module_prefs,
)


async def list_module_connections(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> dict[str, Any]:
    """Unified registrations for a module home Connections tab."""
    if MODULE_BY_SLUG.get(module_slug) is None:
        raise ValueError(f"Unknown module '{module_slug}'")

    prefs = await get_module_prefs(session, tenant_id, module_slug)
    default_connection_id = str(prefs.get("default_connection_id") or "").strip()
    company_map = prefs.get("default_company_by_connection")
    if not isinstance(company_map, dict):
        company_map = {}

    connections: list[dict[str, Any]] = []

    if module_slug == "accounting":
        from app.modules.accounting.router import call_accounting_verb, list_accounting_connections

        rows = await list_accounting_connections(session, tenant_id)
        companies_outcome = await call_accounting_verb(
            session, tenant_id, "list_companies"
        )
        companies_by_conn: dict[str, list[dict[str, Any]]] = {}
        for company in companies_outcome.get("companies") or []:
            if not isinstance(company, dict):
                continue
            cid = str(company.get("connection_id") or "")
            if not cid:
                continue
            companies_by_conn.setdefault(cid, []).append(company)
        for conn in rows:
            default_company = str(company_map.get(conn.id) or "").strip()
            connections.append(
                {
                    "id": conn.id,
                    "kind": "mcp" if conn.vendor in ("king", "bjorn_lunden") else "oauth",
                    "provider": conn.vendor,
                    "vendor": conn.vendor,
                    "display_name": conn.name,
                    "ready": conn.has_credentials,
                    "is_default": conn.id == default_connection_id,
                    "default_company_id": default_company or None,
                    "companies": companies_by_conn.get(conn.id, []),
                }
            )
    else:
        for conn in await active_module_connections(session, tenant_id, module_slug):
            connections.append(
                {
                    "id": str(conn.id),
                    "kind": "oauth",
                    "provider": conn.provider,
                    "vendor": conn.provider,
                    "display_name": conn.display_name or conn.provider,
                    "ready": True,
                    "is_default": str(conn.id) == default_connection_id,
                    "default_company_id": str(company_map.get(str(conn.id)) or "").strip()
                    or None,
                    "companies": [],
                }
            )

    if not default_connection_id and len(connections) == 1:
        connections[0]["is_default"] = True

    return {
        "module_slug": module_slug,
        "default_connection_id": default_connection_id or (
            connections[0]["id"] if len(connections) == 1 else None
        ),
        "connections": connections,
        "prefs": {
            "default_connection_id": default_connection_id or None,
            "default_company_by_connection": company_map,
        },
    }


async def rename_module_connection(
    session: AsyncSession,
    tenant_id: UUID,
    connection_id: UUID,
    *,
    display_name: str,
) -> dict[str, Any]:
    """Rename an IntegrationConnection or native McpServer registration."""
    name = (display_name or "").strip()
    if not name:
        raise ValueError("display_name is required")

    conn = await session.get(IntegrationConnection, connection_id)
    if conn is not None and conn.tenant_id == tenant_id:
        conn.display_name = name
        session.add(conn)
        await session.commit()
        await session.refresh(conn)
        return {"id": str(conn.id), "display_name": conn.display_name, "kind": "oauth"}

    server = await session.get(McpServer, connection_id)
    if server is not None and server.tenant_id == tenant_id:
        server.name = name
        session.add(server)
        await session.commit()
        await session.refresh(server)
        return {"id": str(server.id), "display_name": server.name, "kind": "mcp"}

    raise ValueError("Connection not found")


async def set_module_defaults(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    *,
    default_connection_id: str | None = None,
    default_company_id: str | None = None,
    clear_default_connection: bool = False,
) -> dict[str, Any]:
    company_map = None
    if default_connection_id and default_company_id is not None:
        company_map = {str(default_connection_id): str(default_company_id)}
    elif default_connection_id and default_company_id == "":
        company_map = {str(default_connection_id): ""}
    prefs = await update_module_prefs(
        session,
        tenant_id,
        module_slug,
        default_connection_id=default_connection_id,
        default_company_by_connection=company_map,
        clear_default_connection=clear_default_connection,
    )
    return prefs


def oauth_create_new_from_return_url(return_url: str) -> bool:
    """True when the operator asked for another registration via return URL."""
    try:
        query = parse_qs(urlparse(return_url).query)
    except Exception:
        return False
    raw = (query.get("bokito_create_new") or query.get("create_new") or [""])[0]
    return str(raw).strip().lower() in ("1", "true", "yes")


def oauth_connection_id_from_return_url(return_url: str) -> UUID | None:
    try:
        query = parse_qs(urlparse(return_url).query)
    except Exception:
        return None
    raw = (query.get("bokito_connection_id") or query.get("connection_id") or [""])[0]
    try:
        return UUID(str(raw).strip()) if raw else None
    except ValueError:
        return None
