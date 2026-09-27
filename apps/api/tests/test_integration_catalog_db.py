"""DB-backed remote MCP marketplace catalog."""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.services.integration_catalog_store import (
    create_provider,
    ensure_catalog_fresh,
    ensure_seeded,
    upsert_host,
)
from app.services.integrations_catalog import CORE_PROVIDER_SLUGS, PROVIDER_BY_SLUG
from app.services.integrations_platform import list_providers
from fastapi import HTTPException


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"cat-{uuid4().hex[:8]}", name="Catalog")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


@pytest.mark.asyncio
async def test_seed_and_list_includes_mollie(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await ensure_catalog_fresh(session_override)
    data = await list_providers(session_override, tenant.id)
    slugs = {p["slug"] for p in data["providers"]}
    assert "mollie_mcp" in slugs
    mollie = next(p for p in data["providers"] if p["slug"] == "mollie_mcp")
    assert mollie["status"] == "available"
    assert mollie["mcp_remote_url"] == "https://mcp.mollie.com/mcp"


@pytest.mark.asyncio
async def test_staff_create_provider_appears_in_list_providers(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await ensure_seeded(session_override)
    await upsert_host(
        session_override,
        slug="acmehost",
        name="Acme",
        brand_color="#111111",
        initials="AC",
    )
    row = await create_provider(
        session_override,
        {
            "slug": "acme_live_mcp",
            "name": "Acme Live",
            "host_slug": "acmehost",
            "auth_type": "mcp_remote_oauth",
            "mcp_remote_url": "https://mcp.acme.test/mcp",
            "status": "available",
        },
    )
    assert row.slug == "acme_live_mcp"
    await ensure_catalog_fresh(session_override)
    assert "acme_live_mcp" in PROVIDER_BY_SLUG
    data = await list_providers(session_override, tenant.id)
    found = next(p for p in data["providers"] if p["slug"] == "acme_live_mcp")
    assert found["status"] == "available"
    assert found["mcp_remote_url"] == "https://mcp.acme.test/mcp"


@pytest.mark.asyncio
async def test_oauth_without_url_forced_coming_soon(session_override: AsyncSession):
    await ensure_seeded(session_override)
    await upsert_host(session_override, slug="emptyhost", name="Empty", initials="EM")
    row = await create_provider(
        session_override,
        {
            "slug": "empty_oauth_mcp",
            "name": "Empty OAuth",
            "host_slug": "emptyhost",
            "auth_type": "mcp_remote_oauth",
            "mcp_remote_url": "",
            "status": "available",
        },
    )
    assert row.status == "coming_soon"


@pytest.mark.asyncio
async def test_core_slug_collision_rejected(session_override: AsyncSession):
    await ensure_seeded(session_override)
    reserved = next(iter(CORE_PROVIDER_SLUGS))
    with pytest.raises(HTTPException) as exc:
        await create_provider(
            session_override,
            {
                "slug": reserved,
                "name": "Nope",
                "host_slug": "custom",
                "auth_type": "mcp_remote_oauth",
                "mcp_remote_url": "https://example.com/mcp",
            },
        )
    assert exc.value.status_code == 409
