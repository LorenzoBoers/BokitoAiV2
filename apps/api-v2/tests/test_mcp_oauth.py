"""OAuth AS + MCP endpoint + public API tokens."""

from __future__ import annotations

import base64
import hashlib
import secrets
from urllib.parse import parse_qs, urlparse

from httpx import AsyncClient

from tests.conftest import auth


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=")
    return verifier, challenge.decode()


async def _rpc(client: AsyncClient, token: str, method: str, params: dict | None = None, id_=1):
    r = await client.post(
        "/api/mcp",
        json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}},
        headers={"Authorization": f"Bearer {token}"},
    )
    return r


async def test_metadata_discovery(client: AsyncClient):
    r = await client.get("/.well-known/oauth-protected-resource/api/mcp")
    assert r.status_code == 200
    meta = r.json()
    assert meta["resource"].endswith("/api/mcp")
    assert meta["authorization_servers"][0].endswith("/api/oauth")

    r = await client.get("/.well-known/oauth-authorization-server")
    assert r.status_code == 200
    asm = r.json()
    assert asm["code_challenge_methods_supported"] == ["S256"]
    assert asm["registration_endpoint"].endswith("/api/oauth/register")

    r = await client.get("/api/oauth/.well-known/oauth-authorization-server")
    assert r.status_code == 200


async def test_mcp_requires_token_with_challenge(client: AsyncClient, owner: dict):
    r = await client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert r.status_code == 401
    assert "resource_metadata=" in r.headers["www-authenticate"]

    # A dashboard JWT is not accepted on the MCP endpoint.
    r = await client.post(
        "/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"}, headers=auth(owner)
    )
    assert r.status_code == 401


async def test_oauth_code_flow_and_mcp(client: AsyncClient, owner: dict):
    # 1. Register a public client.
    r = await client.post(
        "/api/oauth/register",
        json={
            "client_name": "Cursor",
            "redirect_uris": ["http://127.0.0.1:33418/callback"],
            "token_endpoint_auth_method": "none",
        },
    )
    assert r.status_code == 201, r.text
    reg = r.json()
    client_id = reg["client_id"]
    assert "client_secret" not in reg

    # 2. Authorize redirects to the consent page in web-v2.
    verifier, challenge = _pkce()
    r = await client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": "http://127.0.0.1:41000/callback",  # loopback: any port
            "scope": "read tools",
            "state": "xyz",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
        follow_redirects=False,
    )
    assert r.status_code == 302, r.text
    consent = urlparse(r.headers["location"])
    assert consent.path == "/oauth/consent"
    q = {k: v[0] for k, v in parse_qs(consent.query).items()}
    assert q["client_id"] == client_id and q["state"] == "xyz"

    # Missing PKCE is rejected by redirecting the error to the client.
    r = await client.get(
        "/api/oauth/authorize",
        params={
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": "http://127.0.0.1:33418/callback",
            "state": "s",
        },
        follow_redirects=False,
    )
    assert r.status_code == 302
    assert "error=invalid_request" in r.headers["location"]

    # 3. Consent context + approve (operator JWT).
    r = await client.get(
        "/api/oauth/consent-context", params={"client_id": client_id}, headers=auth(owner)
    )
    assert r.status_code == 200
    assert r.json()["client_name"] == "Cursor"
    assert r.json()["workspace_name"] == "Acme"

    r = await client.post(
        "/api/oauth/consent",
        json={**q, "approve": True},
        headers=auth(owner),
    )
    assert r.status_code == 200, r.text
    redirect = urlparse(r.json()["redirect_to"])
    cb = {k: v[0] for k, v in parse_qs(redirect.query).items()}
    assert cb["state"] == "xyz"
    code = cb["code"]

    # 4. Token exchange (wrong verifier fails, right one works, code is single-use).
    r = await client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "redirect_uri": q["redirect_uri"],
            "code_verifier": "not-the-verifier",
        },
    )
    assert r.status_code == 400 and r.json()["error"] == "invalid_grant"

    r = await client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "redirect_uri": q["redirect_uri"],
            "code_verifier": verifier,
        },
    )
    assert r.status_code == 200, r.text
    tok = r.json()
    assert tok["access_token"].startswith("bok2o_")
    assert tok["scope"] == "read tools"

    r = await client.post(
        "/api/oauth/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": client_id,
            "redirect_uri": q["redirect_uri"],
            "code_verifier": verifier,
        },
    )
    assert r.status_code == 400  # replay

    # 5. MCP with the access token.
    access = tok["access_token"]
    r = await _rpc(client, access, "initialize", {"protocolVersion": "2025-06-18"})
    assert r.status_code == 200, r.text
    assert r.json()["result"]["serverInfo"]["name"] == "bokito"
    assert r.headers.get("mcp-session-id")

    r = await client.post(
        "/api/mcp",
        json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 202

    r = await _rpc(client, access, "tools/list")
    tools = {t["name"]: t for t in r.json()["result"]["tools"]}
    assert "list_conversations" in tools and "reply" in tools
    assert tools["list_conversations"]["annotations"]["readOnlyHint"] is True
    assert tools["reply"]["annotations"]["openWorldHint"] is True

    r = await _rpc(client, access, "tools/call", {"name": "list_conversations", "arguments": {}})
    result = r.json()["result"]
    assert result["isError"] is False
    assert result["structuredContent"]["status"] == "done"

    # A consequential call under the default posture comes back as a decision, not an error.
    r = await client.post(
        "/api/conversations",
        json={"subject": "MCP test", "channel": "widget"},
        headers=auth(owner),
    )
    conv_id = r.json()["id"]
    r = await _rpc(
        client,
        access,
        "tools/call",
        {"name": "reply", "arguments": {"conversation_id": conv_id, "body": "Hello from MCP"}},
    )
    result = r.json()["result"]
    assert result["isError"] is False
    assert result["structuredContent"]["status"] == "decision"

    r = await _rpc(client, access, "resources/list")
    assert "resources" in r.json()["result"]
    r = await _rpc(client, access, "prompts/get", {"name": "workspace_brief"})
    assert "Decisions waiting" in r.json()["result"]["messages"][0]["content"]["text"]

    # The public REST API accepts the same token (scope read).
    r = await client.get("/api/conversations", headers={"Authorization": f"Bearer {access}"})
    assert r.status_code == 200
    r = await client.post(
        "/api/conversations",
        json={"subject": "x", "channel": "widget"},
        headers={"Authorization": f"Bearer {access}"},
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "insufficient_scope"

    # 6. Grants are visible and refresh rotates.
    r = await client.get("/api/oauth/grants", headers=auth(owner))
    assert r.status_code == 200 and r.json()[0]["client_name"] == "Cursor"

    r = await client.post(
        "/api/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": tok["refresh_token"],
            "client_id": client_id,
        },
    )
    assert r.status_code == 200, r.text
    tok2 = r.json()
    r = await client.post(
        "/api/oauth/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": tok["refresh_token"],
            "client_id": client_id,
        },
    )
    assert r.status_code == 400  # rotated

    # 7. Revoke everything for the client: access token stops working.
    r = await client.delete(f"/api/oauth/grants/{client_id}", headers=auth(owner))
    assert r.status_code == 204
    r = await _rpc(client, tok2["access_token"], "ping")
    assert r.status_code == 401
    assert "invalid_token" in r.headers["www-authenticate"]


async def test_api_token_on_mcp_and_public_api(client: AsyncClient, owner: dict):
    r = await client.post(
        "/api/govern/tokens", json={"name": "ci", "scopes": ["read"]}, headers=auth(owner)
    )
    assert r.status_code == 201
    raw = r.json()["token"]
    assert raw.startswith("bok2_")

    r = await client.get("/api/me", headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 200

    # read-only token cannot use tools (MCP needs the tools scope)
    r = await _rpc(client, raw, "ping")
    assert r.status_code == 403

    r = await client.post(
        "/api/govern/tokens", json={"name": "mcp", "scopes": []}, headers=auth(owner)
    )
    full = r.json()["token"]
    r = await _rpc(client, full, "tools/list")
    assert r.status_code == 200 and r.json()["result"]["tools"]

    # GET stream needs an SSE accept header
    r = await client.get("/api/mcp", headers={"Authorization": f"Bearer {full}"})
    assert r.status_code == 406
