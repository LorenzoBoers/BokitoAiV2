"""MCP OAuth AS: discovery, PKCE, refresh family, resource bind, grants, CORS."""

from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient


def _rpc(method: str, params: dict | None = None, req_id: int = 1) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


async def _login_with_cookie(client: AsyncClient) -> tuple[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200, login.text
    access = login.json()["access_token"]
    tenant_id = login.json()["tenant"]["id"]
    return access, tenant_id


async def _oauth_tokens(
    client: AsyncClient,
    *,
    tenant_id: str,
    scopes: list[str] | None = None,
    resource: str | None = None,
) -> dict:
    reg = await client.post(
        "/api/oauth/register",
        json={
            "client_name": "test-cursor",
            "redirect_uris": ["cursor://anysphere.cursor-mcp/oauth/callback"],
            "token_endpoint_auth_method": "none",
        },
    )
    assert reg.status_code == 200, reg.text
    client_id = reg.json()["client_id"]

    verifier, challenge = _pkce_pair()
    state = "st_" + secrets.token_hex(4)
    params = {
        "client_id": client_id,
        "redirect_uri": "cursor://anysphere.cursor-mcp/oauth/callback",
        "response_type": "code",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "scope": " ".join(scopes or ["workspace", "messaging"]),
    }
    if resource:
        params["resource"] = resource
    authorize = await client.get(
        "/api/oauth/authorize",
        params=params,
        follow_redirects=False,
    )
    assert authorize.status_code in (302, 307)
    request_id = parse_qs(urlparse(authorize.headers["location"]).query)["request_id"][0]

    consent = await client.post(
        "/api/oauth/consent",
        json={
            "authorize_request_id": request_id,
            "tenant_id": tenant_id,
            "scopes": scopes or ["workspace", "messaging"],
        },
    )
    assert consent.status_code == 200, consent.text
    code = parse_qs(urlparse(consent.json()["redirect_to"]).query)["code"][0]

    token_data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": "cursor://anysphere.cursor-mcp/oauth/callback",
        "client_id": client_id,
        "code_verifier": verifier,
    }
    if resource:
        token_data["resource"] = resource
    token_res = await client.post("/api/oauth/token", data=token_data)
    assert token_res.status_code == 200, token_res.text
    body = token_res.json()
    body["client_id"] = client_id
    return body


@pytest.mark.asyncio
async def test_oauth_discovery_documents(client: AsyncClient):
    # Path under /api so single-origin Caddy (/api/* → API) can serve discovery.
    prm = await client.get("/api/oauth/.well-known/oauth-protected-resource")
    assert prm.status_code == 200
    body = prm.json()
    assert body["resource"].endswith("/api/mcp")
    assert any(s.endswith("/api/oauth") for s in body["authorization_servers"])
    assert "messaging" in body["scopes_supported"]

    as_meta = await client.get("/api/oauth/.well-known/openid-configuration")
    assert as_meta.status_code == 200
    meta = as_meta.json()
    assert meta["issuer"].endswith("/api/oauth")
    assert meta["authorization_endpoint"].endswith("/api/oauth/authorize")
    assert meta["token_endpoint"].endswith("/api/oauth/token")
    assert meta["registration_endpoint"].endswith("/api/oauth/register")
    assert meta["revocation_endpoint"].endswith("/api/oauth/revoke")
    assert "S256" in meta["code_challenge_methods_supported"]
    assert "refresh_token" in meta["grant_types_supported"]
    assert meta.get("client_id_metadata_document_supported") is True
    assert meta.get("resource_indicators_supported") is True

    # Root well-known still present for hosts that proxy it.
    root = await client.get("/.well-known/oauth-authorization-server")
    assert root.status_code == 200
    assert root.json()["issuer"].endswith("/api/oauth")

    # RFC 9728 path insert after the resource URL.
    at_mcp = await client.get("/api/mcp/.well-known/oauth-protected-resource")
    assert at_mcp.status_code == 200
    assert at_mcp.json()["resource"].endswith("/api/mcp")


@pytest.mark.asyncio
async def test_mcp_401_includes_resource_metadata(client: AsyncClient):
    res = await client.post("/api/mcp", json=_rpc("initialize"))
    assert res.status_code == 401
    www = res.headers.get("www-authenticate") or res.headers.get("WWW-Authenticate")
    assert www
    assert "resource_metadata=" in www
    assert "/api/oauth/.well-known/oauth-protected-resource" in www


@pytest.mark.asyncio
async def test_mcp_oauth_cors_preflight(client: AsyncClient):
    res = await client.options(
        "/api/mcp",
        headers={
            "Origin": "https://cursor.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type,mcp-session-id",
        },
    )
    assert res.status_code == 204
    assert res.headers.get("access-control-allow-origin") == "*"
    allow = (res.headers.get("access-control-allow-headers") or "").lower()
    assert "authorization" in allow
    assert "mcp-session-id" in allow


@pytest.mark.asyncio
async def test_mcp_get_sse_probe(client: AsyncClient):
    bad = await client.get("/api/mcp", headers={"Accept": "application/json"})
    assert bad.status_code == 406

    ok = await client.get("/api/mcp", headers={"Accept": "text/event-stream"})
    assert ok.status_code == 200
    assert "text/event-stream" in (ok.headers.get("content-type") or "")
    assert "event: endpoint" in ok.text
    www = ok.headers.get("www-authenticate") or ok.headers.get("WWW-Authenticate")
    assert www and "resource_metadata=" in www


@pytest.mark.asyncio
async def test_mcp_oauth_code_pkce_happy_path(client: AsyncClient):
    access, tenant_id = await _login_with_cookie(client)
    tokens = await _oauth_tokens(client, tenant_id=tenant_id)

    assert tokens["access_token"].startswith("bok_oa_")
    assert tokens["refresh_token"].startswith("bok_or_")
    assert tokens["token_type"] == "Bearer"
    assert tokens["resource"].endswith("/api/mcp")

    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    init = await client.post("/api/mcp", json=_rpc("initialize"), headers=headers)
    assert init.status_code == 200
    result = init.json()["result"]
    assert result["serverInfo"]["name"] == "bokito-workspace"
    assert result["serverInfo"]["icons"]
    assert "Govern" in result["instructions"] or "govern" in result["instructions"].lower()
    assert init.headers.get("mcp-session-id")

    listed = await client.post("/api/mcp", json=_rpc("tools/list"), headers=headers)
    assert listed.status_code == 200
    tools = listed.json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert "search_index" in names
    # agents category not in consent scopes
    assert "create_agent" not in names
    sample = next(t for t in tools if t["name"] == "search_index")
    assert "annotations" in sample
    assert sample["annotations"]["readOnlyHint"] is True

    # Bearer API token path still works alongside OAuth.
    tok = await client.post(
        "/api/govern/tokens",
        headers={"Authorization": f"Bearer {access}"},
        json={"name": "legacy", "scopes": []},
    )
    assert tok.status_code == 200
    api_headers = {"Authorization": f"Bearer {tok.json()['token']}"}
    ping = await client.post("/api/mcp", json=_rpc("ping"), headers=api_headers)
    assert ping.status_code == 200


@pytest.mark.asyncio
async def test_oauth_refresh_rotates_and_reuse_kills_family(client: AsyncClient):
    _, tenant_id = await _login_with_cookie(client)
    tokens = await _oauth_tokens(client, tenant_id=tenant_id)
    client_id = tokens["client_id"]
    first_refresh = tokens["refresh_token"]
    first_access = tokens["access_token"]

    refreshed = await client.post(
        "/api/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": first_refresh,
            "client_id": client_id,
        },
    )
    assert refreshed.status_code == 200, refreshed.text
    new_tokens = refreshed.json()
    assert new_tokens["access_token"].startswith("bok_oa_")
    assert new_tokens["refresh_token"] != first_refresh

    # Old access token is revoked after rotation.
    dead = await client.post(
        "/api/mcp",
        json=_rpc("ping"),
        headers={"Authorization": f"Bearer {first_access}"},
    )
    assert dead.status_code == 401

    # New access works.
    alive = await client.post(
        "/api/mcp",
        json=_rpc("ping"),
        headers={"Authorization": f"Bearer {new_tokens['access_token']}"},
    )
    assert alive.status_code == 200

    # Reuse of the old refresh token kills the family.
    reuse = await client.post(
        "/api/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": first_refresh,
            "client_id": client_id,
        },
    )
    assert reuse.status_code == 400
    assert reuse.json()["error"] == "invalid_grant"

    still = await client.post(
        "/api/mcp",
        json=_rpc("ping"),
        headers={"Authorization": f"Bearer {new_tokens['access_token']}"},
    )
    assert still.status_code == 401


@pytest.mark.asyncio
async def test_oauth_resource_mismatch_rejected(client: AsyncClient):
    _, tenant_id = await _login_with_cookie(client)
    tokens = await _oauth_tokens(
        client,
        tenant_id=tenant_id,
        resource="https://evil.example/api/mcp",
    )
    # Token minted for wrong audience must not work on this MCP.
    res = await client.post(
        "/api/mcp",
        json=_rpc("initialize"),
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_oauth_grants_list_and_revoke(client: AsyncClient):
    access, tenant_id = await _login_with_cookie(client)
    tokens = await _oauth_tokens(client, tenant_id=tenant_id)
    client_id = tokens["client_id"]
    auth = {"Authorization": f"Bearer {access}"}

    listed = await client.get("/api/oauth/grants", headers=auth)
    assert listed.status_code == 200, listed.text
    items = listed.json()["items"]
    assert any(g["client_id"] == client_id and g["tenant_id"] == tenant_id for g in items)

    revoked = await client.delete(
        f"/api/oauth/grants/{client_id}/{tenant_id}", headers=auth
    )
    assert revoked.status_code == 200, revoked.text

    dead = await client.post(
        "/api/mcp",
        json=_rpc("ping"),
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert dead.status_code == 401

    after = await client.get("/api/oauth/grants", headers=auth)
    assert not any(
        g["client_id"] == client_id and g["tenant_id"] == tenant_id
        for g in after.json()["items"]
    )


@pytest.mark.asyncio
async def test_oauth_revoke_endpoint(client: AsyncClient):
    _, tenant_id = await _login_with_cookie(client)
    tokens = await _oauth_tokens(client, tenant_id=tenant_id)

    rev = await client.post(
        "/api/oauth/revoke",
        data={"token": tokens["access_token"], "client_id": tokens["client_id"]},
    )
    assert rev.status_code == 200

    dead = await client.post(
        "/api/mcp",
        json=_rpc("ping"),
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert dead.status_code == 401


@pytest.mark.asyncio
async def test_oauth_bad_pkce_rejected(client: AsyncClient):
    _, tenant_id = await _login_with_cookie(client)
    reg = await client.post(
        "/api/oauth/register",
        json={
            "redirect_uris": ["http://127.0.0.1:8731/callback"],
            "token_endpoint_auth_method": "none",
        },
    )
    client_id = reg.json()["client_id"]
    verifier, challenge = _pkce_pair()
    authorize = await client.get(
        "/api/oauth/authorize",
        params={
            "client_id": client_id,
            "redirect_uri": "http://127.0.0.1:8731/callback",
            "response_type": "code",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    request_id = parse_qs(urlparse(authorize.headers["location"]).query)["request_id"][0]
    consent = await client.post(
        "/api/oauth/consent",
        json={"authorize_request_id": request_id, "tenant_id": tenant_id},
    )
    code = parse_qs(urlparse(consent.json()["redirect_to"]).query)["code"][0]

    bad = await client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": "http://127.0.0.1:8731/callback",
            "client_id": client_id,
            "code_verifier": "wrong-verifier-value-xxxxxxxxxxx",
        },
    )
    assert bad.status_code == 400
    assert bad.json()["error"] == "invalid_grant"
    del verifier  # unused; PKCE challenge was bound at authorize time
