"""Module registration listings: connections + defaults for the module home."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationBinding, IntegrationConnection, McpServer
from app.modules.catalog import (
    MODULE_BY_SLUG,
    active_module_connections,
    get_module_prefs,
    update_module_prefs,
)


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _connection_status(
    *,
    has_credentials: bool,
    last_verified_at: str | None,
    verify_error: str | None,
) -> str:
    if not has_credentials:
        return "needs_credentials"
    if verify_error:
        return "error"
    if last_verified_at:
        return "ready"
    return "unverified"


def _row_extras(
    *,
    has_credentials: bool,
    meta: dict[str, Any],
    identity_fallback: str | None = None,
) -> dict[str, Any]:
    last_verified = str(meta.get("last_verified_at") or "").strip() or None
    verify_error = str(meta.get("verify_error") or "").strip() or None
    identity = str(meta.get("identity") or "").strip() or identity_fallback or None
    status = _connection_status(
        has_credentials=has_credentials,
        last_verified_at=last_verified,
        verify_error=verify_error,
    )
    ready = status == "ready"
    return {
        "ready": ready,
        "status": status,
        "identity": identity,
        "last_verified_at": last_verified,
        "verify_error": verify_error,
        "can_disconnect": True,
        "can_verify": True,
    }


def _module_connection_hook(module_slug: str):
    """Per-module connection hook: app.modules.{slug}.connections.list_rows."""
    import importlib

    try:
        mod = importlib.import_module(f"app.modules.{module_slug}.connections")
    except ModuleNotFoundError:
        return None
    return getattr(mod, "list_rows", None)


async def _generic_rows(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> list[dict[str, Any]]:
    """Default rows straight from IntegrationConnection for hookless modules."""
    rows: list[dict[str, Any]] = []
    for conn in await active_module_connections(session, tenant_id, module_slug):
        meta = _parse_json(conn.metadata_json)
        from app.services.moneybird import has_moneybird_credentials

        creds = _parse_json(conn.credentials_json)
        has_creds = bool(creds) and (
            has_moneybird_credentials(creds)
            if conn.provider == "moneybird"
            else bool(str(creds.get("access_token") or creds.get("api_key") or "").strip()
            or creds.get("mock"))
        )
        # OAuth rows without tokens are not ready; mock calendar may still sync in non-prod.
        if conn.provider in ("google_calendar", "outlook_calendar") and creds.get("mock"):
            has_creds = True
        rows.append(
            {
                "id": str(conn.id),
                "kind": "oauth",
                "provider": conn.provider,
                "vendor": conn.provider,
                "display_name": conn.display_name or conn.provider,
                "has_credentials": has_creds,
                "meta": meta,
                "identity_fallback": str(
                    meta.get("email") or meta.get("external_account_id") or ""
                )
                or None,
                "companies": [],
            }
        )
    return rows


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

    hook = _module_connection_hook(module_slug)
    raw_rows = (
        await hook(session, tenant_id)
        if hook is not None
        else await _generic_rows(session, tenant_id, module_slug)
    )

    connections: list[dict[str, Any]] = []
    for row in raw_rows:
        if not row.get("has_credentials"):
            # Operator UI: only list registrations that actually connected.
            # Incomplete OAuth/MCP ghosts stay out of Connections.
            continue
        extras = _row_extras(
            has_credentials=True,
            meta=row.get("meta") or {},
            identity_fallback=row.get("identity_fallback"),
        )
        cid = str(row["id"])
        connections.append(
            {
                "id": cid,
                "kind": row.get("kind") or "oauth",
                "provider": row.get("provider"),
                "vendor": row.get("vendor") or row.get("provider"),
                "display_name": row.get("display_name") or row.get("provider"),
                "is_default": cid == default_connection_id,
                "default_company_id": str(company_map.get(cid) or "").strip() or None,
                "companies": row.get("companies") or [],
                **extras,
            }
        )

    if not default_connection_id and len(connections) == 1 and connections[0]["ready"]:
        connections[0]["is_default"] = True

    from app.config import get_settings

    tenant_writes = bool(prefs.get("writes_enabled"))
    platform_writes = get_settings().module_writes_allowed(module_slug)
    return {
        "module_slug": module_slug,
        "default_connection_id": default_connection_id or (
            connections[0]["id"]
            if len(connections) == 1 and connections[0]["ready"]
            else None
        ),
        "connections": connections,
        "prefs": {
            "default_connection_id": default_connection_id or None,
            "default_company_by_connection": company_map,
            "writes_enabled": tenant_writes,
            "user_access": prefs.get("user_access"),
        },
        # Writes execute only when the platform switch AND tenant pref are on.
        "writes_active": platform_writes and tenant_writes,
    }


async def rename_module_connection(
    session: AsyncSession,
    tenant_id: UUID,
    connection_id: UUID,
    *,
    display_name: str,
) -> dict[str, Any]:
    """Rename an IntegrationConnection or native McpServer registration label."""
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
        # Keep linked IntegrationConnection display_name in sync when present.
        bindings = await session.execute(
            select(IntegrationBinding).where(
                IntegrationBinding.tenant_id == tenant_id,
                IntegrationBinding.binding_type == "mcp_server",
            )
        )
        for binding in bindings.scalars().all():
            config = _parse_json(binding.config_json)
            if str(config.get("mcp_server_id") or "") == str(server.id):
                linked = await session.get(IntegrationConnection, binding.connection_id)
                if linked is not None and linked.tenant_id == tenant_id:
                    linked.display_name = name
                    session.add(linked)
        await session.commit()
        await session.refresh(server)
        return {"id": str(server.id), "display_name": server.name, "kind": "mcp"}

    raise ValueError("Connection not found")


async def _clear_module_default_if_needed(
    session: AsyncSession, tenant_id: UUID, module_slug: str, connection_id: str
) -> None:
    prefs = await get_module_prefs(session, tenant_id, module_slug)
    if str(prefs.get("default_connection_id") or "") == connection_id:
        await update_module_prefs(
            session,
            tenant_id,
            module_slug,
            clear_default_connection=True,
        )


async def disconnect_module_connection(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    connection_id: UUID,
) -> dict[str, Any]:
    """Revoke an OAuth connection or deactivate a native MCP registration."""
    if MODULE_BY_SLUG.get(module_slug) is None:
        raise ValueError(f"Unknown module '{module_slug}'")

    cid = str(connection_id)

    # Moneybird / OAuth path: IntegrationConnection id.
    conn = await session.get(IntegrationConnection, connection_id)
    if conn is not None and conn.tenant_id == tenant_id and conn.status != "revoked":
        from app.services.integrations_platform import revoke_connection

        await revoke_connection(session, tenant_id, connection_id)
        await _clear_module_default_if_needed(session, tenant_id, module_slug, cid)
        return {"ok": True, "id": cid, "kind": "oauth"}

    # KING / Björn path: McpServer id is the module connection id.
    server = await session.get(McpServer, connection_id)
    if server is not None and server.tenant_id == tenant_id:
        server.is_active = False
        session.add(server)
        bindings = await session.execute(
            select(IntegrationBinding).where(
                IntegrationBinding.tenant_id == tenant_id,
                IntegrationBinding.binding_type == "mcp_server",
            )
        )
        for binding in bindings.scalars().all():
            config = _parse_json(binding.config_json)
            if str(config.get("mcp_server_id") or "") != cid:
                continue
            linked = await session.get(IntegrationConnection, binding.connection_id)
            if linked is not None and linked.tenant_id == tenant_id:
                linked.status = "revoked"
                session.add(linked)
            await session.delete(binding)
        await session.commit()
        await _clear_module_default_if_needed(session, tenant_id, module_slug, cid)
        return {"ok": True, "id": cid, "kind": "mcp"}

    raise HTTPException(status_code=404, detail="Connection not found")


async def verify_module_connection(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    connection_id: UUID,
) -> dict[str, Any]:
    """Live-verify a module registration and persist identity / last_verified_at."""
    if MODULE_BY_SLUG.get(module_slug) is None:
        raise ValueError(f"Unknown module '{module_slug}'")

    cid = str(connection_id)
    now = datetime.now(timezone.utc).isoformat()

    server = await session.get(McpServer, connection_id)
    if server is not None and server.tenant_id == tenant_id and server.is_active:
        from app.services.integrations_platform import test_mcp_server

        result = await test_mcp_server(session, tenant_id, server.id)
        auth = _parse_json(server.auth_json)
        ok = bool(result.get("ok")) and not result.get("note")
        identity = str(auth.get("identity") or "").strip() or None
        if ok and not identity and server.server_url.startswith("native://"):
            import importlib

            try:
                hook_mod = importlib.import_module(
                    f"app.modules.{module_slug}.connections"
                )
            except ModuleNotFoundError:
                hook_mod = None
            identity_hook = getattr(hook_mod, "verify_identity", None) if hook_mod else None
            if callable(identity_hook):
                identity = identity_hook(server.server_url, auth)
        if ok:
            auth["last_verified_at"] = now
            auth.pop("verify_error", None)
            if identity:
                auth["identity"] = identity
        else:
            auth["verify_error"] = str(
                result.get("error") or result.get("note") or "Verification failed"
            )
        server.auth_json = json.dumps(auth)
        session.add(server)
        await session.commit()
        return {
            "ok": ok,
            "id": cid,
            "kind": "mcp",
            "identity": identity if ok else None,
            "last_verified_at": now if ok else None,
            "error": None if ok else auth.get("verify_error"),
            "status": "ready" if ok else (
                "needs_credentials" if result.get("note") else "error"
            ),
        }

    conn = await session.get(IntegrationConnection, connection_id)
    if conn is None or conn.tenant_id != tenant_id or conn.status == "revoked":
        raise HTTPException(status_code=404, detail="Connection not found")

    meta = _parse_json(conn.metadata_json)
    creds = _parse_json(conn.credentials_json)
    ok = False
    identity = str(meta.get("identity") or meta.get("email") or "").strip() or None
    error: str | None = None

    if conn.provider == "moneybird":
        from app.services.moneybird import (
            has_moneybird_credentials,
            list_administrations,
            validate_credentials,
        )

        if not has_moneybird_credentials(creds):
            error = "Moneybird credentials are missing. Complete OAuth or add an API token."
        else:
            check = await validate_credentials(creds)
            if check.get("ok") and not check.get("note"):
                ok = True
                try:
                    admins = await list_administrations(creds)
                    if admins:
                        identity = str(admins[0].get("name") or admins[0].get("id") or identity)
                except Exception:
                    pass
            else:
                error = str(check.get("error") or check.get("note") or "Moneybird verification failed")
    else:
        # Generic OAuth: treat presence of access_token as verified shape.
        token = str(creds.get("access_token") or creds.get("api_key") or "").strip()
        if token:
            ok = True
            identity = identity or str(meta.get("external_account_id") or conn.display_name or "")
        elif creds.get("mock"):
            error = "Mock connection cannot be verified against a live provider."
        else:
            error = "Credentials are missing. Complete the provider setup."

    if ok:
        meta["last_verified_at"] = now
        meta.pop("verify_error", None)
        if identity:
            meta["identity"] = identity
    else:
        meta["verify_error"] = error or "Verification failed"
    conn.metadata_json = json.dumps(meta)
    session.add(conn)
    await session.commit()
    return {
        "ok": ok,
        "id": cid,
        "kind": "oauth",
        "identity": identity if ok else None,
        "last_verified_at": now if ok else None,
        "error": None if ok else meta.get("verify_error"),
        "status": "ready" if ok else ("needs_credentials" if "missing" in (error or "").lower() else "error"),
    }


async def set_module_defaults(
    session: AsyncSession,
    tenant_id: UUID,
    module_slug: str,
    *,
    default_connection_id: str | None = None,
    default_company_id: str | None = None,
    clear_default_connection: bool = False,
) -> dict[str, Any]:
    if default_connection_id:
        listing = await list_module_connections(session, tenant_id, module_slug)
        match = next(
            (c for c in listing["connections"] if c["id"] == str(default_connection_id)),
            None,
        )
        if match is None:
            raise ValueError("Connection not found for this module")
        if not match.get("ready"):
            raise ValueError("Only a verified ready registration can be the default")
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
