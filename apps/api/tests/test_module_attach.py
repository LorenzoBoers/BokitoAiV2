"""Independent partner registrations + optional module attach."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.integration import IntegrationConnection
from app.modules.catalog import active_module_connections
from app.services.module_attach import (
    attach_connection_to_module,
    detach_connection_from_module,
    list_eligible_connections,
    maybe_auto_attach_from_return_url,
    module_slug_from_return_url,
    provider_allowed_for_module,
)


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"attach-{uuid4().hex[:8]}", name="Attach")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


async def _moneybird(session: AsyncSession, tenant: Tenant) -> IntegrationConnection:
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="moneybird",
        display_name="Moneybird loose",
        status="active",
        credentials_json='{"access_token":"tok"}',
        metadata_json='{"last_verified_at":"2026-01-01T00:00:00+00:00"}',
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)
    return conn


def test_module_slug_from_return_url():
    assert (
        module_slug_from_return_url(
            "https://app.bokito.ai/modules/accounting?connect=moneybird&bokito_module=accounting"
        )
        == "accounting"
    )
    assert (
        module_slug_from_return_url("https://app.bokito.ai/modules/accounting?connect=moneybird")
        == "accounting"
    )
    assert module_slug_from_return_url("https://app.bokito.ai/modules/marketplace?connect=moneybird") is None
    assert module_slug_from_return_url("https://app.bokito.ai/modules/connected") is None


def test_provider_allowed_for_module():
    assert provider_allowed_for_module("moneybird", "accounting") is True
    assert provider_allowed_for_module("slack_mcp", "accounting") is False


@pytest.mark.asyncio
async def test_unattached_moneybird_hidden_from_module(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    await _moneybird(session_override, tenant)
    assert await active_module_connections(session_override, tenant.id, "accounting") == []
    eligible = await list_eligible_connections(session_override, tenant.id, "accounting")
    assert len(eligible) == 1
    assert eligible[0]["provider"] == "moneybird"


@pytest.mark.asyncio
async def test_attach_then_list(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    await attach_connection_to_module(session_override, tenant.id, conn.id, "accounting")
    rows = await active_module_connections(session_override, tenant.id, "accounting")
    assert [str(r.id) for r in rows] == [str(conn.id)]
    eligible = await list_eligible_connections(session_override, tenant.id, "accounting")
    assert eligible == []


@pytest.mark.asyncio
async def test_cannot_attach_wrong_provider(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="github",
        display_name="GitHub",
        status="active",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)
    with pytest.raises(HTTPException) as exc:
        await attach_connection_to_module(session_override, tenant.id, conn.id, "accounting")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_auto_attach_from_module_return_url(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    await maybe_auto_attach_from_return_url(
        session_override,
        tenant.id,
        conn,
        "https://app.bokito.ai/modules/accounting?connect=moneybird",
    )
    await session_override.commit()
    rows = await active_module_connections(session_override, tenant.id, "accounting")
    assert [str(r.id) for r in rows] == [str(conn.id)]


@pytest.mark.asyncio
async def test_marketplace_return_url_does_not_attach(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    await maybe_auto_attach_from_return_url(
        session_override,
        tenant.id,
        conn,
        "https://app.bokito.ai/modules/marketplace?connect=moneybird",
    )
    await session_override.commit()
    assert await active_module_connections(session_override, tenant.id, "accounting") == []


@pytest.mark.asyncio
async def test_detach_keeps_connection(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    await attach_connection_to_module(session_override, tenant.id, conn.id, "accounting")
    await detach_connection_from_module(session_override, tenant.id, conn.id, "accounting")
    assert await active_module_connections(session_override, tenant.id, "accounting") == []
    refreshed = await session_override.get(IntegrationConnection, conn.id)
    assert refreshed is not None
    assert refreshed.status == "active"


@pytest.mark.asyncio
async def test_connected_summary_lists_unattached_moneybird(session_override: AsyncSession):
    from app.services.integrations_platform import list_connected_summary

    tenant = await _tenant(session_override)
    conn = await _moneybird(session_override, tenant)
    data = await list_connected_summary(session_override, tenant.id)
    row = next(item for item in data["connections"] if item["id"] == str(conn.id))
    assert row["kind"] == "app"
    assert row["provider"] == "moneybird"
    assert row["eligible_module"] == "accounting"
    assert row["attached_modules"] == []
