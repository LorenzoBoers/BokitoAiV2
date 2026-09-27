"""DB-backed remote MCP marketplace catalog (seed + staff CRUD + cache).

JSON ``mcp_remote_catalog.json`` is the seed source only. Runtime reads go
through Postgres so staff can add OAuth/URL presets without a deploy.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.integration_catalog import IntegrationCatalogHost, IntegrationCatalogProvider
from app.services.mcp_remote_catalog import catalog_hosts, catalog_providers

CACHE_TTL_SECONDS = 30.0

_remote_provider_dicts: list[dict[str, Any]] = []
_remote_host_dicts: list[dict[str, Any]] = []
_cache_loaded_at: float = 0.0
_cache_dirty: bool = True


def invalidate_catalog_cache() -> None:
    global _cache_dirty
    _cache_dirty = True


def cached_remote_providers() -> list[dict[str, Any]]:
    return list(_remote_provider_dicts)


def cached_remote_hosts() -> list[dict[str, Any]]:
    return list(_remote_host_dicts)


def _normalize_status(auth_type: str, url: str, status: str) -> str:
    status = (status or "coming_soon").strip() or "coming_soon"
    if auth_type == "mcp_remote_oauth" and not url.strip():
        return "coming_soon"
    if status not in ("available", "coming_soon"):
        return "coming_soon"
    return status


def serialize_host(row: IntegrationCatalogHost) -> dict[str, Any]:
    return {
        "slug": row.slug,
        "name": row.name,
        "brand_color": row.brand_color,
        "initials": row.initials,
        "logo_domain": row.logo_domain or None,
        "simpleicons": row.simpleicons or None,
        "description": row.description or None,
    }


def serialize_provider_row(row: IntegrationCatalogProvider) -> dict[str, Any]:
    return {
        "slug": row.slug,
        "static_id": row.static_id or row.slug,
        "host_slug": row.host_slug,
        "name": row.name,
        "description": row.description,
        "category": row.category,
        "category_nl": row.category_nl,
        "auth_type": row.auth_type,
        "mcp_remote_url": row.mcp_remote_url or "",
        "mcp_transport": row.mcp_transport or "streamable_http",
        "status": row.status,
        "module": row.module,
        "sort_order": row.sort_order,
        "enabled": row.enabled,
    }


async def ensure_seeded(session: AsyncSession) -> None:
    """Insert missing hosts/providers from JSON. Never overwrite existing rows."""
    existing_hosts = {
        row[0]
        for row in (
            await session.execute(select(IntegrationCatalogHost.slug))
        ).all()
    }
    existing_providers = {
        row[0]
        for row in (
            await session.execute(select(IntegrationCatalogProvider.slug))
        ).all()
    }
    added = False
    now = datetime.utcnow()
    for host in catalog_hosts():
        slug = str(host.get("slug") or "").strip()
        if not slug or slug in existing_hosts:
            continue
        session.add(
            IntegrationCatalogHost(
                slug=slug,
                name=str(host.get("name") or slug),
                brand_color=str(host.get("brand_color") or "#475569"),
                initials=str(host.get("initials") or slug[:2].upper()),
                logo_domain=str(host.get("logo_domain") or ""),
                simpleicons=str(host.get("simpleicons") or ""),
                description=str(host.get("description") or ""),
                created_at=now,
                updated_at=now,
            )
        )
        existing_hosts.add(slug)
        added = True

    # Ensure a custom host exists for orphaned providers.
    if "custom" not in existing_hosts:
        session.add(
            IntegrationCatalogHost(
                slug="custom",
                name="Custom MCP",
                brand_color="#475569",
                initials="MC",
                created_at=now,
                updated_at=now,
            )
        )
        existing_hosts.add("custom")
        added = True

    for index, prov in enumerate(catalog_providers()):
        slug = str(prov.get("slug") or "").strip()
        if not slug or slug in existing_providers:
            continue
        host_slug = str(prov.get("host_slug") or "custom").strip() or "custom"
        if host_slug not in existing_hosts:
            host_slug = "custom"
        url = str(prov.get("mcp_remote_url") or "").strip()
        auth = str(prov.get("auth_type") or "mcp_remote_oauth")
        status = _normalize_status(auth, url, str(prov.get("status") or "coming_soon"))
        session.add(
            IntegrationCatalogProvider(
                slug=slug,
                static_id=str(prov.get("static_id") or slug),
                host_slug=host_slug,
                name=str(prov.get("name") or slug),
                description=str(prov.get("description") or ""),
                category=str(prov.get("category") or "Productivity"),
                category_nl=str(prov.get("category_nl") or prov.get("category") or "Productiviteit"),
                auth_type=auth,
                mcp_remote_url=url,
                mcp_transport=str(prov.get("mcp_transport") or "streamable_http"),
                status=status,
                module=str(prov["module"]) if prov.get("module") else None,
                sort_order=20 + index,
                enabled=True,
                created_at=now,
                updated_at=now,
            )
        )
        existing_providers.add(slug)
        added = True

    if added:
        await session.commit()
        invalidate_catalog_cache()


async def refresh_remote_catalog_cache(session: AsyncSession) -> None:
    """Load enabled DB rows into the process cache and rebuild PROVIDER_BY_SLUG."""
    global _remote_provider_dicts, _remote_host_dicts, _cache_loaded_at, _cache_dirty

    from app.services.integrations_catalog import (
        rebuild_provider_index,
        remote_row_to_provider,
    )

    host_result = await session.execute(select(IntegrationCatalogHost))
    hosts = list(host_result.scalars().all())
    host_by_slug = {h.slug: h for h in hosts}

    prov_result = await session.execute(
        select(IntegrationCatalogProvider)
        .where(IntegrationCatalogProvider.enabled.is_(True))
        .order_by(IntegrationCatalogProvider.sort_order, IntegrationCatalogProvider.name)
    )
    providers = list(prov_result.scalars().all())

    _remote_host_dicts = [serialize_host(h) for h in hosts]
    _remote_provider_dicts = []
    for index, row in enumerate(providers):
        host = host_by_slug.get(row.host_slug)
        _remote_provider_dicts.append(
            remote_row_to_provider(serialize_provider_row(row), host=host, index=index)
        )

    rebuild_provider_index(_remote_provider_dicts, _remote_host_dicts)
    _cache_loaded_at = time.monotonic()
    _cache_dirty = False


async def ensure_catalog_fresh(session: AsyncSession) -> None:
    await ensure_seeded(session)
    stale = _cache_dirty or (time.monotonic() - _cache_loaded_at) > CACHE_TTL_SECONDS
    if stale or not _remote_provider_dicts:
        await refresh_remote_catalog_cache(session)


async def list_catalog_hosts(session: AsyncSession, *, include_disabled: bool = False) -> list[IntegrationCatalogHost]:
    result = await session.execute(
        select(IntegrationCatalogHost).order_by(IntegrationCatalogHost.name)
    )
    return list(result.scalars().all())


async def list_catalog_providers(
    session: AsyncSession, *, enabled_only: bool = False
) -> list[IntegrationCatalogProvider]:
    stmt = select(IntegrationCatalogProvider).order_by(
        IntegrationCatalogProvider.sort_order, IntegrationCatalogProvider.name
    )
    if enabled_only:
        stmt = stmt.where(IntegrationCatalogProvider.enabled.is_(True))
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_catalog_host(session: AsyncSession, slug: str) -> IntegrationCatalogHost | None:
    return await session.get(IntegrationCatalogHost, slug)


async def get_catalog_provider(session: AsyncSession, slug: str) -> IntegrationCatalogProvider | None:
    return await session.get(IntegrationCatalogProvider, slug)


def _reject_core_slug(slug: str) -> None:
    from app.services.integrations_catalog import CORE_PROVIDER_SLUGS

    if slug in CORE_PROVIDER_SLUGS:
        raise HTTPException(
            status_code=409,
            detail=f"Slug '{slug}' is reserved for a native core integration.",
        )


async def upsert_host(
    session: AsyncSession,
    *,
    slug: str,
    name: str,
    brand_color: str = "#475569",
    initials: str = "",
    logo_domain: str = "",
    simpleicons: str = "",
    description: str = "",
) -> IntegrationCatalogHost:
    slug = slug.strip()
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")
    row = await get_catalog_host(session, slug)
    now = datetime.utcnow()
    if row is None:
        row = IntegrationCatalogHost(
            slug=slug,
            name=name or slug,
            brand_color=brand_color or "#475569",
            initials=initials or slug[:2].upper(),
            logo_domain=logo_domain or "",
            simpleicons=simpleicons or "",
            description=description or "",
            created_at=now,
            updated_at=now,
        )
        session.add(row)
    else:
        row.name = name or row.name
        row.brand_color = brand_color or row.brand_color
        if initials:
            row.initials = initials
        row.logo_domain = logo_domain if logo_domain is not None else row.logo_domain
        row.simpleicons = simpleicons if simpleicons is not None else row.simpleicons
        row.description = description if description is not None else row.description
        row.updated_at = now
        session.add(row)
    await session.commit()
    await session.refresh(row)
    invalidate_catalog_cache()
    return row


async def delete_host(session: AsyncSession, slug: str) -> None:
    row = await get_catalog_host(session, slug)
    if not row:
        raise HTTPException(status_code=404, detail="Host not found")
    linked = await session.execute(
        select(IntegrationCatalogProvider.slug).where(
            IntegrationCatalogProvider.host_slug == slug
        ).limit(1)
    )
    if linked.first():
        raise HTTPException(
            status_code=400,
            detail="Host still has providers; delete or reassign them first.",
        )
    await session.delete(row)
    await session.commit()
    invalidate_catalog_cache()


async def create_provider(session: AsyncSession, body: dict[str, Any]) -> IntegrationCatalogProvider:
    slug = str(body.get("slug") or "").strip()
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")
    _reject_core_slug(slug)
    if await get_catalog_provider(session, slug):
        raise HTTPException(status_code=409, detail="Provider slug already exists")
    host_slug = str(body.get("host_slug") or "custom").strip() or "custom"
    if not await get_catalog_host(session, host_slug):
        raise HTTPException(status_code=400, detail=f"Unknown host_slug '{host_slug}'")
    url = str(body.get("mcp_remote_url") or "").strip()
    auth = str(body.get("auth_type") or "mcp_remote_oauth")
    status = _normalize_status(auth, url, str(body.get("status") or "available"))
    now = datetime.utcnow()
    row = IntegrationCatalogProvider(
        slug=slug,
        static_id=str(body.get("static_id") or slug),
        host_slug=host_slug,
        name=str(body.get("name") or slug),
        description=str(body.get("description") or ""),
        category=str(body.get("category") or "Productivity"),
        category_nl=str(body.get("category_nl") or body.get("category") or "Productiviteit"),
        auth_type=auth,
        mcp_remote_url=url,
        mcp_transport=str(body.get("mcp_transport") or "streamable_http"),
        status=status,
        module=str(body["module"]) if body.get("module") else None,
        sort_order=int(body.get("sort_order") or 100),
        enabled=bool(body["enabled"]) if body.get("enabled") is not None else True,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    invalidate_catalog_cache()
    return row


async def update_provider(
    session: AsyncSession, slug: str, body: dict[str, Any]
) -> IntegrationCatalogProvider:
    row = await get_catalog_provider(session, slug)
    if not row:
        raise HTTPException(status_code=404, detail="Provider not found")
    if "host_slug" in body and body["host_slug"] is not None:
        host_slug = str(body["host_slug"]).strip() or "custom"
        if not await get_catalog_host(session, host_slug):
            raise HTTPException(status_code=400, detail=f"Unknown host_slug '{host_slug}'")
        row.host_slug = host_slug
    for field in (
        "static_id",
        "name",
        "description",
        "category",
        "category_nl",
        "auth_type",
        "mcp_remote_url",
        "mcp_transport",
        "module",
    ):
        if field in body and body[field] is not None:
            setattr(row, field, body[field] if field != "module" else (body[field] or None))
    if "sort_order" in body and body["sort_order"] is not None:
        row.sort_order = int(body["sort_order"])
    if "enabled" in body and body["enabled"] is not None:
        row.enabled = bool(body["enabled"])
    url = str(row.mcp_remote_url or "")
    auth = str(row.auth_type or "mcp_remote_oauth")
    status_in = body.get("status") if "status" in body else row.status
    row.status = _normalize_status(auth, url, str(status_in or "coming_soon"))
    row.updated_at = datetime.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    invalidate_catalog_cache()
    return row


async def delete_provider(session: AsyncSession, slug: str) -> None:
    row = await get_catalog_provider(session, slug)
    if not row:
        raise HTTPException(status_code=404, detail="Provider not found")
    await session.delete(row)
    await session.commit()
    invalidate_catalog_cache()
