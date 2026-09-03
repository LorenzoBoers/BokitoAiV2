"""Explicit attach between partner registrations and business modules.

A connection lives on its own. A module may use it only when the provider is
in that module's ``provider_slugs`` and an ``IntegrationBinding`` of type
``module`` exists.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs, urlparse
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration import IntegrationBinding, IntegrationConnection, McpServer
from app.modules.catalog import MODULE_BY_SLUG, module_for_provider

MODULE_BINDING = "module"
RESERVED_MODULE_PATHS = frozenset({"connected", "marketplace", "tools"})
# Hub path segments that carry a module slug: `/connections/{slug}` today,
# `/modules/{slug}` on links minted before the hub moved.
MODULE_PATH_ROOTS = ("connections", "modules")


def _parse_json(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def provider_allowed_for_module(provider: str, module_slug: str) -> bool:
    spec = MODULE_BY_SLUG.get(module_slug)
    if spec is None:
        return False
    return provider in spec.provider_slugs


def module_slug_from_return_url(return_url: str) -> str | None:
    """Module slug when the operator started OAuth from a module page."""
    if not return_url:
        return None
    try:
        parsed = urlparse(return_url)
        query = parse_qs(parsed.query)
    except Exception:
        return None
    raw = (query.get("bokito_module") or [""])[0].strip()
    if raw in MODULE_BY_SLUG:
        return raw
    parts = [p for p in parsed.path.strip("/").split("/") if p]
    if (
        len(parts) >= 2
        and parts[0] in MODULE_PATH_ROOTS
        and parts[1] not in RESERVED_MODULE_PATHS
    ):
        slug = parts[1]
        if slug in MODULE_BY_SLUG:
            return slug
    return None


async def list_module_bindings(
    session: AsyncSession, tenant_id: UUID, module_slug: str | None = None
) -> list[IntegrationBinding]:
    result = await session.execute(
        select(IntegrationBinding).where(
            IntegrationBinding.tenant_id == tenant_id,
            IntegrationBinding.binding_type == MODULE_BINDING,
        )
    )
    rows = list(result.scalars().all())
    if module_slug is None:
        return rows
    return [
        row
        for row in rows
        if str(_parse_json(row.config_json).get("module_slug") or "") == module_slug
    ]


async def attached_connection_ids(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> set[str]:
    return {str(row.connection_id) for row in await list_module_bindings(session, tenant_id, module_slug)}


async def attached_modules_by_connection(
    session: AsyncSession, tenant_id: UUID
) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for row in await list_module_bindings(session, tenant_id):
        slug = str(_parse_json(row.config_json).get("module_slug") or "").strip()
        if not slug:
            continue
        out.setdefault(str(row.connection_id), []).append(slug)
    return out


async def attached_mcp_server_ids(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> set[str]:
    """McpServer ids whose IntegrationConnection is attached to the module."""
    attached = await attached_connection_ids(session, tenant_id, module_slug)
    if not attached:
        return set()
    result = await session.execute(
        select(IntegrationBinding).where(
            IntegrationBinding.tenant_id == tenant_id,
            IntegrationBinding.binding_type == "mcp_server",
        )
    )
    ids: set[str] = set()
    for binding in result.scalars().all():
        if str(binding.connection_id) not in attached:
            continue
        server_id = str(_parse_json(binding.config_json).get("mcp_server_id") or "").strip()
        if server_id:
            ids.add(server_id)
    return ids


async def resolve_integration_connection_id(
    session: AsyncSession, tenant_id: UUID, connection_id: UUID
) -> UUID:
    """Accept an IntegrationConnection id or a native McpServer id."""
    conn = await session.get(IntegrationConnection, connection_id)
    if conn is not None and conn.tenant_id == tenant_id:
        return conn.id
    server = await session.get(McpServer, connection_id)
    if server is None or server.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Connection not found")
    result = await session.execute(
        select(IntegrationBinding).where(
            IntegrationBinding.tenant_id == tenant_id,
            IntegrationBinding.binding_type == "mcp_server",
        )
    )
    for binding in result.scalars().all():
        if str(_parse_json(binding.config_json).get("mcp_server_id") or "") == str(server.id):
            return binding.connection_id
    raise HTTPException(status_code=404, detail="Connection not found")


async def attach_connection_to_module(
    session: AsyncSession,
    tenant_id: UUID,
    connection_id: UUID,
    module_slug: str,
    *,
    commit: bool = True,
) -> IntegrationBinding:
    if MODULE_BY_SLUG.get(module_slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    ic_id = await resolve_integration_connection_id(session, tenant_id, connection_id)
    conn = await session.get(IntegrationConnection, ic_id)
    if conn is None or conn.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Connection not found")
    if conn.status == "revoked":
        raise HTTPException(status_code=400, detail="Cannot attach a revoked connection")
    if not provider_allowed_for_module(conn.provider, module_slug):
        raise HTTPException(
            status_code=400,
            detail=(
                f"{conn.provider} is not a package on this module. "
                "Attach only partners defined on the module."
            ),
        )
    existing = await list_module_bindings(session, tenant_id, module_slug)
    for row in existing:
        if row.connection_id == ic_id:
            return row
    binding = IntegrationBinding(
        tenant_id=tenant_id,
        connection_id=ic_id,
        binding_type=MODULE_BINDING,
        config_json=json.dumps({"module_slug": module_slug}),
    )
    session.add(binding)
    if commit:
        await session.commit()
        await session.refresh(binding)
    else:
        await session.flush()
    return binding


async def detach_connection_from_module(
    session: AsyncSession,
    tenant_id: UUID,
    connection_id: UUID,
    module_slug: str,
) -> dict[str, Any]:
    if MODULE_BY_SLUG.get(module_slug) is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    ic_id = await resolve_integration_connection_id(session, tenant_id, connection_id)
    removed = False
    for row in await list_module_bindings(session, tenant_id, module_slug):
        if row.connection_id == ic_id:
            await session.delete(row)
            removed = True
    if not removed:
        raise HTTPException(status_code=404, detail="Connection is not attached to this module")
    from app.services.module_connections import _clear_module_default_if_needed

    await session.flush()
    await _clear_module_default_if_needed(session, tenant_id, module_slug, str(connection_id))
    await _clear_module_default_if_needed(session, tenant_id, module_slug, str(ic_id))
    await session.commit()
    return {"ok": True, "id": str(connection_id), "detached": True}


async def maybe_auto_attach_from_return_url(
    session: AsyncSession,
    tenant_id: UUID,
    connection: IntegrationConnection,
    return_url: str,
) -> None:
    slug = module_slug_from_return_url(return_url)
    if not slug:
        return
    if not provider_allowed_for_module(connection.provider, slug):
        return
    await attach_connection_to_module(
        session, tenant_id, connection.id, slug, commit=False
    )


async def maybe_auto_attach_for_module(
    session: AsyncSession,
    tenant_id: UUID,
    connection: IntegrationConnection,
    module_slug: str | None,
) -> None:
    if not module_slug:
        return
    if not provider_allowed_for_module(connection.provider, module_slug):
        return
    await attach_connection_to_module(
        session, tenant_id, connection.id, module_slug, commit=False
    )


async def list_eligible_connections(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> list[dict[str, Any]]:
    """Active registrations this module may attach (defined providers, not yet attached)."""
    spec = MODULE_BY_SLUG.get(module_slug)
    if spec is None:
        raise HTTPException(status_code=404, detail="Unknown module")
    attached = await attached_connection_ids(session, tenant_id, module_slug)
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.status == "active",
            IntegrationConnection.provider.in_(list(spec.provider_slugs)),
        )
    )
    rows = []
    for conn in result.scalars().all():
        if str(conn.id) in attached:
            continue
        rows.append(
            {
                "id": str(conn.id),
                "provider": conn.provider,
                "display_name": conn.display_name or conn.provider,
                "status": conn.status,
            }
        )
    return rows


async def backfill_module_attachments(session: AsyncSession) -> int:
    """Attach existing active rows whose provider already belongs to a module."""
    result = await session.execute(
        select(IntegrationConnection).where(IntegrationConnection.status == "active")
    )
    created = 0
    for conn in result.scalars().all():
        slug = module_for_provider(conn.provider)
        if not slug or not provider_allowed_for_module(conn.provider, slug):
            continue
        existing = await attached_connection_ids(session, conn.tenant_id, slug)
        if str(conn.id) in existing:
            continue
        session.add(
            IntegrationBinding(
                tenant_id=conn.tenant_id,
                connection_id=conn.id,
                binding_type=MODULE_BINDING,
                config_json=json.dumps({"module_slug": slug}),
            )
        )
        created += 1
    if created:
        await session.commit()
    return created
