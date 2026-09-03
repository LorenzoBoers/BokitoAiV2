"""Module connection integrity: install requires credentials, verify + disconnect."""

from uuid import uuid4

import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import Tenant
from app.models.integration import McpServer
from app.services.integrations_platform import install_mcp
from app.services.king_finance import KING_NATIVE_URL
from app.services.module_connections import (
    disconnect_module_connection,
    list_module_connections,
    verify_module_connection,
)


async def _tenant(session: AsyncSession) -> Tenant:
    tenant = Tenant(slug=f"conn-{uuid4().hex[:8]}", name="Conn Integrity")
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return tenant


@pytest.mark.asyncio
async def test_king_install_without_credentials_rejected(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    with pytest.raises(HTTPException) as exc:
        await install_mcp(
            session_override,
            tenant.id,
            provider="king_accountancy",
            api_key="",
            display_name="KING",
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_king_mock_install_hidden_until_credentials(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    installed = await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        display_name="KING Mock",
        use_mock=True,
    )
    from app.services.partner_mcp import is_partner_mcp_url, partner_mcp_url

    assert is_partner_mcp_url(installed["binding"]["config"]["server_url"]) == "king"
    assert installed["binding"]["config"]["server_url"] == partner_mcp_url("king")
    assert installed.get("verified") is False

    listing = await list_module_connections(session_override, tenant.id, "accounting")
    # Incomplete registrations stay out of the operator Connections list.
    assert listing["connections"] == []


@pytest.mark.asyncio
async def test_disconnect_deactivates_mcp_server(session_override: AsyncSession):
    tenant = await _tenant(session_override)
    installed = await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        use_mock=True,
    )
    server_id = installed["mcp_server_id"]
    await disconnect_module_connection(
        session_override, tenant.id, "accounting", __import__("uuid").UUID(server_id)
    )
    server = await session_override.get(McpServer, __import__("uuid").UUID(server_id))
    assert server is not None
    assert server.is_active is False
    listing = await list_module_connections(session_override, tenant.id, "accounting")
    assert listing["connections"] == []


@pytest.mark.asyncio
async def test_verify_without_credentials_fails(session_override: AsyncSession, monkeypatch):
    tenant = await _tenant(session_override)
    monkeypatch.setattr(get_settings(), "king_finance_partner_key", "")
    installed = await install_mcp(
        session_override,
        tenant.id,
        provider="king_accountancy",
        api_key="",
        use_mock=True,
    )
    server_id = __import__("uuid").UUID(installed["mcp_server_id"])
    result = await verify_module_connection(
        session_override, tenant.id, "accounting", server_id
    )
    assert result["ok"] is False
    listing = await list_module_connections(session_override, tenant.id, "accounting")
    assert listing["connections"] == []


@pytest.mark.asyncio
async def test_moneybird_oauth_start_creates_no_ghost(client: AsyncClient):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": f"mb-ghost-{uuid4().hex[:8]}@example.com",
            "password": "test-password",
            "tenant_slug": f"mb-ghost-{uuid4().hex[:8]}",
            "tenant_name": "MB Ghost",
        },
    )
    assert signup.status_code == 200
    headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
    res = await client.get(
        "/api/integrations/oauth/start",
        headers=headers,
        params={
            "provider": "moneybird",
            "return_url": "http://127.0.0.1:5174/modules/accounting?connect=moneybird",
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert "oauth_not_configured" in body["authorize_url"]
    listing = await client.get(
        "/api/integrations/modules/accounting/connections",
        headers=headers,
    )
    if listing.status_code == 200:
        rows = listing.json().get("connections") or []
        assert all(r.get("vendor") != "moneybird" for r in rows)


@pytest.mark.asyncio
async def test_mcp_install_http_rejects_empty_king(client: AsyncClient):
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": f"conn-{uuid4().hex[:8]}@example.com",
            "password": "test-password",
            "tenant_slug": f"conn-{uuid4().hex[:8]}",
            "tenant_name": "Conn",
        },
    )
    assert signup.status_code == 200
    headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
    res = await client.post(
        "/api/integrations/mcp/install",
        headers=headers,
        json={"provider": "king_accountancy", "display_name": "Empty KING"},
    )
    assert res.status_code == 400
