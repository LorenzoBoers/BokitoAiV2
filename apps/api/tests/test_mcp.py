import json
from uuid import uuid4

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


async def _tool_names(client: AsyncClient, headers: dict[str, str]) -> set[str]:
    listed = await client.post("/api/mcp", json=_rpc("tools/list"), headers=headers)
    assert listed.status_code == 200
    return {t["name"] for t in listed.json()["result"]["tools"]}


async def _call_tool(
    client: AsyncClient, headers: dict[str, str], name: str, arguments: dict
) -> dict:
    """Call a tool and return the decoded payload the handler produced."""
    res = await client.post(
        "/api/mcp",
        json=_rpc("tools/call", {"name": name, "arguments": arguments}),
        headers=headers,
    )
    assert res.status_code == 200, res.text
    return json.loads(res.json()["result"]["content"][0]["text"])


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
    result = init.json()["result"]
    assert result["serverInfo"]["name"] == "bokito-workspace"
    assert result["serverInfo"]["icons"]
    assert result["instructions"]
    assert init.headers.get("mcp-session-id")
    caps = result["capabilities"]
    assert "tools" in caps
    assert "resources" in caps
    assert "prompts" in caps

    resources = await client.post("/api/mcp", json=_rpc("resources/list"), headers=headers)
    assert resources.status_code == 200
    assert any(r["uri"].startswith("bokito://docs/") for r in resources.json()["result"]["resources"])

    read = await client.post(
        "/api/mcp",
        json=_rpc("resources/read", {"uri": "bokito://docs/mcp-endpoint"}),
        headers=headers,
    )
    assert read.status_code == 200
    text = read.json()["result"]["contents"][0]["text"]
    assert "MCP" in text
    assert len(text) > 200

    prompts = await client.post("/api/mcp", json=_rpc("prompts/list"), headers=headers)
    assert prompts.status_code == 200
    assert {p["name"] for p in prompts.json()["result"]["prompts"]} >= {
        "tenant_overview",
        "open_threads",
        "search_knowledge",
    }

    prompt = await client.post(
        "/api/mcp",
        json=_rpc(
            "prompts/get",
            {"name": "search_knowledge", "arguments": {"query": "refunds"}},
        ),
        headers=headers,
    )
    assert prompt.status_code == 200
    assert "refunds" in prompt.json()["result"]["messages"][0]["content"]["text"]

    listed = await client.post("/api/mcp", json=_rpc("tools/list"), headers=headers)
    assert listed.status_code == 200
    tools = listed.json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert "search_index" in names
    assert "create_agent" in names
    assert any(t.get("annotations", {}).get("readOnlyHint") for t in tools)

    deleted = await client.delete(
        "/api/mcp", headers={**headers, "Mcp-Session-Id": init.headers["mcp-session-id"]}
    )
    assert deleted.status_code == 204


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
async def test_mcp_lists_contact_workforce_and_govern_tools(client: AsyncClient):
    token = await _make_token(client)
    names = await _tool_names(client, {"Authorization": f"Bearer {token}"})
    assert {
        "list_contacts",
        "get_contact",
        "upsert_contact",
        "list_agents",
        "get_agent",
        "list_playbooks",
        "get_playbook",
        "list_triggers",
        "resolve_decision",
    } <= names


@pytest.mark.asyncio
async def test_mcp_contact_tools_round_trip(client: AsyncClient):
    token = await _make_token(client, scopes=["messaging"])
    headers = {"Authorization": f"Bearer {token}"}

    created = await _call_tool(
        client,
        headers,
        "upsert_contact",
        {"email": "Ada@example.com", "name": "Ada Lovelace", "company": "Analytical"},
    )
    assert created["created"] is True
    assert created["address"] == "ada@example.com"
    contact_id = created["id"]

    updated = await _call_tool(
        client, headers, "upsert_contact", {"email": "ada@example.com", "notes": "Prefers email"}
    )
    assert updated["created"] is False
    # Omitted fields keep whatever was known before.
    assert updated["display_name"] == "Ada Lovelace"
    assert updated["notes"] == "Prefers email"

    listed = await _call_tool(client, headers, "list_contacts", {"query": "lovelace"})
    assert [c["id"] for c in listed["contacts"]] == [contact_id]

    fetched = await _call_tool(client, headers, "get_contact", {"contact_id": contact_id})
    assert fetched["company"] == "Analytical"
    assert fetched["thread_count"] == 0

    missing = await _call_tool(client, headers, "get_contact", {"contact_id": str(uuid4())})
    assert missing["error"] == "Contact not found"


@pytest.mark.asyncio
async def test_mcp_workforce_reads_are_tenant_scoped(client: AsyncClient):
    token = await _make_token(client, scopes=["agents", "triggers"])
    headers = {"Authorization": f"Bearer {token}"}

    agents = await _call_tool(client, headers, "list_agents", {})
    slugs = {a["slug"] for a in agents["agents"]}
    assert {"assistant", "orchestra"} <= slugs

    detail = await _call_tool(client, headers, "get_agent", {"agent_slug": "assistant"})
    assert detail["name"] == "Test Assistant"
    assert detail["purpose"] == "Test assistant"

    playbooks = await _call_tool(client, headers, "list_playbooks", {})
    assert isinstance(playbooks["playbooks"], list)

    triggers = await _call_tool(client, headers, "list_triggers", {})
    assert isinstance(triggers["triggers"], list)


@pytest.mark.asyncio
async def test_mcp_resolve_decision_always_asks_a_human(client: AsyncClient):
    from app.tools.registry import get_tool_spec

    spec = get_tool_spec("resolve_decision")
    assert spec is not None
    assert spec.consequential is True
    assert spec.gated is True
    assert spec.mutating is True
    assert spec.category == "govern"

    token = await _make_token(client, scopes=["govern"])
    headers = {"Authorization": f"Bearer {token}"}
    result = await _call_tool(
        client,
        headers,
        "resolve_decision",
        {"decision_id": str(uuid4()), "action": "approve"},
    )
    # Consequential tools never execute unasked: the call lands as a card.
    assert result["status"] == "awaiting_human"
    assert result["decision_request_id"]


@pytest.mark.asyncio
async def test_mcp_tickets_scope_exposes_ticket_tools(client: AsyncClient):
    token = await _make_token(client, scopes=["tickets"])
    names = await _tool_names(client, {"Authorization": f"Bearer {token}"})
    assert {"list_categories", "get_ticket", "file_ticket", "update_ticket"} <= names
    assert "search_index" not in names
    assert "create_agent" not in names


def test_tool_categories_stay_consistent():
    from app.tools.policy import AUTONOMY_POSTURES
    from app.tools.registry import TOOL_CATEGORIES, iter_tool_specs

    unknown = {
        spec.name: spec.category
        for spec in iter_tool_specs()
        if spec.category not in TOOL_CATEGORIES
    }
    assert unknown == {}
    # Every category needs a default in every posture, or its tools silently
    # fall back to "ask" (or never appear in the Govern sliders).
    for posture, config in AUTONOMY_POSTURES.items():
        assert set(config["allowances"]) == set(TOOL_CATEGORIES), posture


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
