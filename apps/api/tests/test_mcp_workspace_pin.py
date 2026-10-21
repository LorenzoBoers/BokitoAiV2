"""Workspace MCP URL (/api/mcp/w/{slug}): pinned consent, tenant-bound tokens, legacy scopes."""

from __future__ import annotations

import json
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.services import mcp_oauth_as as asvc
from tests.test_mcp_oauth import _login_with_cookie, _oauth_tokens, _pkce_pair, _rpc


async def _authorize(client: AsyncClient, resource: str) -> str:
    reg = await client.post(
        "/api/oauth/register",
        json={
            "client_name": "pin-test",
            "redirect_uris": ["cursor://anysphere.cursor-mcp/oauth/callback"],
            "token_endpoint_auth_method": "none",
        },
    )
    _verifier, challenge = _pkce_pair()
    res = await client.get(
        "/api/oauth/authorize",
        params={
            "client_id": reg.json()["client_id"],
            "redirect_uri": "cursor://anysphere.cursor-mcp/oauth/callback",
            "response_type": "code",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "resource": resource,
        },
        follow_redirects=False,
    )
    return parse_qs(urlparse(res.headers["location"]).query)["request_id"][0]


@pytest.mark.asyncio
async def test_workspace_discovery_and_challenge(client: AsyncClient):
    prm = await client.get("/api/oauth/.well-known/oauth-protected-resource/api/mcp/w/test")
    assert prm.status_code == 200
    assert prm.json()["resource"].endswith("/api/mcp/w/test")
    at_path = await client.get("/api/mcp/w/test/.well-known/oauth-protected-resource")
    assert at_path.json()["resource"].endswith("/api/mcp/w/test")

    res = await client.post("/api/mcp/w/test", json=_rpc("initialize"))
    assert res.status_code == 401
    assert "/oauth-protected-resource/api/mcp/w/test" in res.headers["www-authenticate"]


@pytest.mark.asyncio
async def test_consent_is_pinned_to_the_workspace(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    other = Tenant(slug="other", name="Other")
    session_override.add(other)
    await session_override.commit()
    _access, tenant_id = await _login_with_cookie(client)

    request_id = await _authorize(client, asvc.mcp_resource_url("test"))
    ctx = (await client.get("/api/oauth/consent-context", params={"request_id": request_id})).json()
    assert ctx["pinned_workspace"] == {
        "slug": "test",
        "tenant_id": tenant_id,
        "tenant_name": "Test Tenant",
        "member": True,
    }
    wrong = await client.post(
        "/api/oauth/consent",
        json={"authorize_request_id": request_id, "tenant_id": str(other.id)},
    )
    assert wrong.status_code in (400, 403)

    # Not a member of the pinned workspace: the screen says so.
    request_id = await _authorize(client, asvc.mcp_resource_url("other"))
    ctx = (await client.get("/api/oauth/consent-context", params={"request_id": request_id})).json()
    assert ctx["pinned_workspace"]["member"] is False
    refused = await client.post(
        "/api/oauth/consent",
        json={"authorize_request_id": request_id, "tenant_id": tenant_id},
    )
    assert refused.status_code == 400


@pytest.mark.asyncio
async def test_workspace_url_rejects_a_token_for_another_workspace(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    session_override.add(Tenant(slug="other", name="Other"))
    await session_override.commit()
    _access, tenant_id = await _login_with_cookie(client)
    pinned = await _oauth_tokens(client, tenant_id=tenant_id, resource=asvc.mcp_resource_url("test"))
    assert pinned["resource"].endswith("/api/mcp/w/test")
    headers = {"Authorization": f"Bearer {pinned['access_token']}"}

    ok = await client.post("/api/mcp/w/test", json=_rpc("ping"), headers=headers)
    assert ok.status_code == 200
    # The same token still works on the base URL (one token, its own workspace).
    assert (await client.post("/api/mcp", json=_rpc("ping"), headers=headers)).status_code == 200

    other = await client.post("/api/mcp/w/other", json=_rpc("ping"), headers=headers)
    assert other.status_code == 401
    assert "/api/mcp/w/other" in other.headers["www-authenticate"]
    missing = await client.post("/api/mcp/w/nope", json=_rpc("ping"), headers=headers)
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_legacy_cases_scope_lists_ticket_tools(client: AsyncClient, session_override):
    from app.models.oauth_as import McpOAuthAccessToken

    _access, tenant_id = await _login_with_cookie(client)
    tokens = await _oauth_tokens(client, tenant_id=tenant_id, scopes=["workspace"])
    row = (
        await session_override.execute(
            select(McpOAuthAccessToken).where(
                McpOAuthAccessToken.token_prefix == tokens["access_token"][:16]
            )
        )
    ).scalar_one()
    row.scopes_json = json.dumps(["workspace", "cases"])
    session_override.add(row)
    await session_override.commit()

    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    listed = await client.post("/api/mcp", json=_rpc("tools/list"), headers=headers)
    names = {t["name"] for t in listed.json()["result"]["tools"]}
    assert {"get_ticket", "update_ticket", "list_categories"} <= names
