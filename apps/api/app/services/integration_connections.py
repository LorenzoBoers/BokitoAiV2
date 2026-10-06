"""Provider-scoped connection management: every registration to one provider.

Backs the provider modal (Moneybird, KING, ...). Rows share the module
connection DTO (``module_connections._row_extras``) and are enriched with the
same scope fields the module page shows: ``instance_key``, linked projects,
attached modules, access summary and whether the viewer may manage it.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationConnection, McpServer


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _server_has_credentials(provider: str, auth: dict[str, Any]) -> bool:
    if provider == "king_accountancy":
        from app.services.king_finance import has_king_credentials

        return has_king_credentials(auth) or bool(auth.get("mock"))
    if provider == "bjorn_lunden_mcp":
        from app.services.bjorn_lunden import has_bl_credentials

        return has_bl_credentials(auth) or bool(auth.get("mock"))
    return bool(
        str(auth.get("api_key") or auth.get("bearer_token") or auth.get("access_token") or "").strip()
        or auth.get("mock")
    )


def _identity_fallback(provider: str, meta: dict[str, Any], auth: dict[str, Any]) -> str | None:
    if provider == "king_accountancy":
        from app.services.king_finance import parse_administraties

        admins = parse_administraties(auth)
        if admins:
            return admins[0].get("name") or None
    return str(meta.get("email") or meta.get("external_account_id") or "") or None


async def enrich_rows(
    session: AsyncSession,
    tenant_id: UUID,
    rows: list[dict[str, Any]],
    *,
    user_id: UUID | None = None,
    role: str | None = None,
) -> list[dict[str, Any]]:
    """Add scope fields to connection rows keyed by ``connection_id`` (IntegrationConnection id)."""
    from app.services.connection_access import connection_access, is_default_access, user_level
    from app.services.connection_scope import project_links, project_names
    from app.services.module_attach import attached_modules_by_connection

    ic_ids: list[UUID] = []
    for row in rows:
        try:
            ic_ids.append(UUID(str(row.get("connection_id") or row["id"])))
        except (ValueError, KeyError):
            continue
    conns = {
        str(c.id): c
        for c in (
            await session.execute(
                select(IntegrationConnection).where(
                    IntegrationConnection.tenant_id == tenant_id,
                    IntegrationConnection.id.in_(ic_ids),
                )
            )
        ).scalars().all()
    } if ic_ids else {}
    links = await project_links(session, tenant_id, ic_ids)
    names = await project_names(session, tenant_id, {p for ps in links.values() for p in ps})
    modules = await attached_modules_by_connection(session, tenant_id)
    for row in rows:
        cid = str(row.get("connection_id") or row["id"])
        conn = conns.get(cid)
        row["connection_id"] = cid if conn is not None else row.get("connection_id")
        row["instance_key"] = (conn.instance_key or None) if conn is not None else None
        project_ids = links.get(cid, [])
        row["projects"] = [{"id": p, "name": names.get(p, "")} for p in project_ids]
        row["attached_modules"] = modules.get(cid, [])
        if conn is not None:
            row["access_restricted"] = not is_default_access(conn)
            row["access"] = connection_access(conn)
            if user_id is not None and role is not None:
                level = await user_level(session, conn, user_id=user_id, role=role)
                row["can_manage"] = level == "manage"
                row["can_use"] = level is not None
            else:
                row["can_manage"] = True
                row["can_use"] = True
        else:
            row["access_restricted"] = False
            row["access"] = []
            row["can_manage"] = role is None or role in ("owner", "admin")
            row["can_use"] = True
        if not row["can_manage"]:
            row["can_verify"] = False
            row["can_disconnect"] = False
    return rows


async def list_provider_connections(
    session: AsyncSession,
    tenant_id: UUID,
    provider: str,
    *,
    user_id: UUID | None = None,
    role: str | None = None,
) -> list[dict[str, Any]]:
    """Active registrations for one canonical provider, oldest first."""
    from app.services.connection_instance import converge_once
    from app.services.crypto import get_connection_credentials
    from app.services.integrations_catalog import canonical_provider_slug
    from app.services.module_connections import _row_extras, bound_mcp_server

    slug = canonical_provider_slug(provider) or provider
    if slug in ("moneybird", "king_accountancy"):
        await converge_once(session, tenant_id)
    conns = (
        await session.execute(
            select(IntegrationConnection)
            .where(
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.provider == slug,
                IntegrationConnection.status == "active",
            )
            .order_by(IntegrationConnection.created_at.asc())
        )
    ).scalars().all()
    rows: list[dict[str, Any]] = []
    for conn in conns:
        meta = _parse_json(conn.metadata_json)
        server = await bound_mcp_server(session, tenant_id, conn.id)
        if server is not None:
            auth = _parse_json(server.auth_json)
            has_creds = _server_has_credentials(conn.provider, auth)
            row_meta = {**meta, **{k: v for k, v in auth.items() if k in (
                "identity", "last_verified_at", "verify_error")}}
            fallback = _identity_fallback(conn.provider, meta, auth)
        else:
            creds = get_connection_credentials(conn)
            if conn.provider == "moneybird":
                from app.services.moneybird import has_moneybird_credentials

                has_creds = has_moneybird_credentials(creds)
            else:
                has_creds = bool(
                    str(creds.get("access_token") or creds.get("api_key") or "").strip()
                    or creds.get("mock")
                )
            row_meta = meta
            fallback = _identity_fallback(conn.provider, meta, {})
        extras = _row_extras(has_credentials=has_creds, meta=row_meta, identity_fallback=fallback)
        rows.append(
            {
                "id": str(conn.id),
                "connection_id": str(conn.id),
                "mcp_server_id": str(server.id) if server is not None else None,
                "kind": "mcp" if server is not None else "oauth",
                "provider": conn.provider,
                "vendor": conn.provider,
                "display_name": conn.display_name or conn.provider,
                "created_at": conn.created_at.isoformat() if conn.created_at else None,
                **extras,
                "ready": extras["ready"],
            }
        )
    return await enrich_rows(session, tenant_id, rows, user_id=user_id, role=role)


async def get_tenant_connection(
    session: AsyncSession, tenant_id: UUID, connection_id: UUID
) -> IntegrationConnection:
    """IntegrationConnection by its id or by its native McpServer id (404 otherwise)."""
    from fastapi import HTTPException

    from app.services.module_attach import resolve_integration_connection_id

    ic_id = await resolve_integration_connection_id(session, tenant_id, connection_id)
    conn = await session.get(IntegrationConnection, ic_id)
    if conn is None or conn.tenant_id != tenant_id or conn.status != "active":
        raise HTTPException(status_code=404, detail="Connection not found")
    return conn


async def rename_connection(
    session: AsyncSession, tenant_id: UUID, conn: IntegrationConnection, display_name: str
) -> dict[str, Any]:
    """Rename the registration and its native MCP server label."""
    from app.services.module_connections import bound_mcp_server

    name = (display_name or "").strip()
    if not name:
        raise ValueError("display_name is required")
    conn.display_name = name
    session.add(conn)
    server: McpServer | None = await bound_mcp_server(session, tenant_id, conn.id)
    if server is not None:
        server.name = name
        session.add(server)
    await session.commit()
    return {"id": str(conn.id), "display_name": name}


async def clear_module_defaults_for(
    session: AsyncSession, tenant_id: UUID, conn: IntegrationConnection
) -> None:
    """Drop module defaults that point at this connection (or its MCP server)."""
    from app.models.module_install import ModuleInstall
    from app.services.connection_instance import _mcp_server_ids

    refs = {str(conn.id), *(str(s) for s in await _mcp_server_ids(session, tenant_id, conn.id))}
    installs = (
        await session.execute(select(ModuleInstall).where(ModuleInstall.tenant_id == tenant_id))
    ).scalars().all()
    for install in installs:
        if install.default_connection_id and install.default_connection_id in refs:
            install.default_connection_id = None
            session.add(install)
