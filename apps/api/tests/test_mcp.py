import pytest
from httpx import AsyncClient


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _make_token(client: AsyncClient, scopes: list[str] | None = None) -> str:
    headers = await _auth_headers(client)
    res = await client.post(
        "/api/govern/tokens", headers=headers, json={"name": "test", "scopes": scopes or []}
    )
    assert res.status_code == 200
    return res.json()["token"]


def _rpc(method: str, params: dict | None = None, req_id: int = 1) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "method": method, "params": params or {}}


@pytest.mark.asyncio
async def test_mcp_requires_token(client: AsyncClient):
    res = await client.post("/api/mcp", json=_rpc("initialize"))
    assert res.status_code == 401

    res = await client.post(
        "/api/mcp", json=_rpc("initialize"), headers={"Authorization": "Bearer bok_invalid"}
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_mcp_initialize_and_list_tools(client: AsyncClient):
    token = await _make_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    init = await client.post("/api/mcp", json=_rpc("initialize"), headers=headers)
    assert init.status_code == 200
    assert init.json()["result"]["serverInfo"]["name"] == "bokito-workspace"

    listed = await client.post("/api/mcp", json=_rpc("tools/list"), headers=headers)
    assert listed.status_code == 200
    tools = listed.json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert "search_index" in names
    assert "create_agent" in names


@pytest.mark.asyncio
async def test_mcp_scoped_token_limits_tools(client: AsyncClient):
    token = await _make_token(client, scopes=["workspace"])
    headers = {"Authorization": f"Bearer {token}"}

    listed = await client.post("/api/mcp", json=_rpc("tools/list"), headers=headers)
    tools = listed.json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert "search_index" in names
    assert "create_agent" not in names

    call = await client.post(
        "/api/mcp",
        json=_rpc("tools/call", {"name": "create_agent", "arguments": {"name": "X"}}),
        headers=headers,
    )
    assert call.json().get("error", {}).get("code") == -32602


@pytest.mark.asyncio
async def test_mcp_tool_call_executes(client: AsyncClient):
    token = await _make_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    call = await client.post(
        "/api/mcp",
        json=_rpc("tools/call", {"name": "search_index", "arguments": {"query": "blueprint"}}),
        headers=headers,
    )
    assert call.status_code == 200
    result = call.json()["result"]
    assert result["isError"] is False
    assert result["content"][0]["type"] == "text"


@pytest.mark.asyncio
async def test_mcp_revoked_token_rejected(client: AsyncClient):
    headers = await _auth_headers(client)
    res = await client.post("/api/govern/tokens", headers=headers, json={"name": "doomed", "scopes": []})
    created = res.json()
    await client.delete(f"/api/govern/tokens/{created['id']}", headers=headers)

    call = await client.post(
        "/api/mcp",
        json=_rpc("tools/list"),
        headers={"Authorization": f"Bearer {created['token']}"},
    )
    assert call.status_code == 401
