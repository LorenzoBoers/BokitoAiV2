"""Module hub API: connections, prefs, sources."""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.integration import IntegrationConnection
from app.modules.catalog import set_module_enabled
from app.services.module_sources import ACCOUNTING_PLATFORM_SEEDS, ensure_platform_seeds, list_sources
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api"


async def _login(client: AsyncClient) -> str:
    res = await client.post(
        f"{API}/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_module_prefs_and_connections(client: AsyncClient, session_override: AsyncSession):
    token = await _login(client)
    headers = _auth(token)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    from app.models.agent import Agent
    from app.services.module_agents import add_module_agent

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalar_one()
    await add_module_agent(session_override, tenant.id, "accounting", agent.id, is_default=True)
    await set_module_enabled(session_override, tenant.id, "accounting", True)
    # Only credentialed + verified connections are listed and can become the
    # module default, so seed both markers.
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="moneybird",
        display_name="Moneybird A",
        status="active",
        credentials_json=json.dumps({"access_token": "test-token"}),
        metadata_json=json.dumps({"last_verified_at": "2026-01-01T00:00:00+00:00"}),
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    listed = await client.get(
        f"{API}/integrations/modules/accounting/connections", headers=headers
    )
    assert listed.status_code == 200
    body = listed.json()
    assert any(c["id"] == str(conn.id) for c in body["connections"])

    patched = await client.patch(
        f"{API}/integrations/modules/accounting/prefs",
        headers=headers,
        json={"default_connection_id": str(conn.id)},
    )
    assert patched.status_code == 200
    assert patched.json()["prefs"]["default_connection_id"] == str(conn.id)

    renamed = await client.patch(
        f"{API}/integrations/modules/accounting/connections/{conn.id}",
        headers=headers,
        json={"display_name": "Office Moneybird"},
    )
    assert renamed.status_code == 200
    assert renamed.json()["connection"]["display_name"] == "Office Moneybird"


@pytest.mark.asyncio
async def test_platform_seeds_and_tenant_source(client: AsyncClient, session_override: AsyncSession):
    token = await _login(client)
    headers = _auth(token)
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    from app.models.agent import Agent
    from app.services.module_agents import add_module_agent

    agent = (
        await session_override.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
    ).scalar_one()
    await add_module_agent(session_override, tenant.id, "accounting", agent.id, is_default=True)
    await set_module_enabled(session_override, tenant.id, "accounting", True)
    seeds = await ensure_platform_seeds(session_override, tenant.id, "accounting")
    assert len(seeds) >= len(ACCOUNTING_PLATFORM_SEEDS)
    rows = await list_sources(session_override, tenant.id, "accounting")
    assert len(rows) >= len(ACCOUNTING_PLATFORM_SEEDS)

    created = await client.post(
        f"{API}/integrations/modules/accounting/sources",
        headers=headers,
        json={"title": "Office site", "url": "https://example.com/regs"},
    )
    assert created.status_code == 200
    source_id = created.json()["source"]["id"]

    listed = await client.get(
        f"{API}/integrations/modules/accounting/sources", headers=headers
    )
    assert listed.status_code == 200
    assert any(s["id"] == source_id for s in listed.json()["sources"])

    deleted = await client.delete(
        f"{API}/integrations/modules/accounting/sources/{source_id}",
        headers=headers,
    )
    assert deleted.status_code == 200
