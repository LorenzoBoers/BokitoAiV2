"""Remote MCP over Streamable HTTP: session, SSE, expiry, OAuth refresh, schemas, hints."""

import json
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import select

from app.models.auth import Tenant


class FakeMcp:
    """A vendor MCP endpoint at https://fake.test/mcp with a token endpoint."""

    def __init__(self) -> None:
        self.token = "old"
        self.refresh_ok = True
        self.sessions: set[str] = set()
        self.calls: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path == "/token":
            form = dict(x.split("=", 1) for x in request.content.decode().split("&"))
            if not self.refresh_ok or form.get("grant_type") != "refresh_token":
                return httpx.Response(400, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": self.token, "expires_in": 3600})
        if request.headers.get("authorization") != f"Bearer {self.token}":
            return httpx.Response(401)
        msg = json.loads(request.content)
        method = msg.get("method")
        self.calls.append(method)
        if method == "initialize":
            sid = uuid4().hex
            self.sessions.add(sid)
            body = {"jsonrpc": "2.0", "id": msg["id"], "result": {"protocolVersion": "2025-06-18"}}
            return httpx.Response(
                200,
                headers={"content-type": "text/event-stream", "mcp-session-id": sid},
                text=f"event: message\ndata: {json.dumps(body)}\n\n",
            )
        if method == "notifications/initialized":
            return httpx.Response(202)
        if request.headers.get("mcp-session-id") not in self.sessions:
            return httpx.Response(404)
        if method == "tools/list":
            tools = [
                {
                    "name": "search",
                    "description": "Search pages",
                    "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}},
                    "annotations": {"readOnlyHint": True},
                },
                {"name": "create_page", "description": "Create a page", "inputSchema": {"type": "object"}},
            ]
            body = {"jsonrpc": "2.0", "id": msg["id"], "result": {"tools": tools}}
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, text=f"data: {json.dumps(body)}\n\n"
            )
        if method == "tools/call":
            text = f"found {msg['params']['arguments'].get('query')}"
            return httpx.Response(
                200, json={"jsonrpc": "2.0", "id": msg["id"], "result": {"content": [{"type": "text", "text": text}]}}
            )
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": msg.get("id"), "error": {"message": "unknown"}})


@pytest.fixture
def fake_mcp(monkeypatch):
    from app.services import mcp_remote_client

    fake = FakeMcp()
    monkeypatch.setattr(mcp_remote_client, "transport", httpx.MockTransport(fake.handler))
    mcp_remote_client._SESSIONS.clear()
    yield fake
    mcp_remote_client._SESSIONS.clear()


async def _server(session, name: str):
    from app.services.integrations_platform import register_mcp_server

    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    auth = {
        "auth_type": "oauth2",
        "mode": "remote_oauth",
        "access_token": "old",
        "refresh_token": "r1",
        "token_endpoint": "https://fake.test/token",
        "client_id": "bokito",
    }
    server, conn, _ = await register_mcp_server(
        session, tenant.id, name=name, server_url="https://fake.test/mcp", auth=auth, provider="notion_mcp"
    )
    await session.commit()
    return tenant.id, server, conn


@pytest.mark.asyncio
async def test_discovery_and_call_over_streamable_http(client, session_override, fake_mcp):
    from app.services.agent.mcp_client import call_mcp_tool
    from app.services.integrations_platform import test_mcp_server
    from app.services.mcp_remote_client import _SESSIONS, is_read_only_mcp_call

    name = f"Notion {uuid4().hex[:4]}"
    tenant_id, server, conn = await _server(session_override, name)

    found = await test_mcp_server(session_override, tenant_id, server.id)
    assert found["ok"] is True and found["tool_count"] == 2
    assert fake_mcp.calls[:3] == ["initialize", "notifications/initialized", "tools/list"]
    cached = json.loads(server.tools_json)
    assert cached[0]["input_schema"]["properties"]["query"]["type"] == "string"
    await session_override.refresh(conn)
    assert json.loads(conn.metadata_json)["health"]["status"] == "ok"

    assert await is_read_only_mcp_call(session_override, tenant_id, {"server_name": name, "tool_name": "search"})
    assert not await is_read_only_mcp_call(
        session_override, tenant_id, {"server_name": name, "tool_name": "create_page"}
    )

    fake_mcp.sessions.clear()
    out = await call_mcp_tool(
        session_override, tenant_id, {"server_name": name, "tool_name": "search", "arguments": {"query": "kick-off"}}
    )
    assert out["result"]["content"][0]["text"] == "found kick-off"
    assert fake_mcp.calls.count("initialize") == 2
    assert _SESSIONS[server.id].session_id in fake_mcp.sessions


@pytest.mark.asyncio
async def test_expired_token_refreshes_then_asks_to_reconnect(client, session_override, fake_mcp):
    from app.services.agent.mcp_client import call_mcp_tool

    name = f"Canva {uuid4().hex[:4]}"
    tenant_id, server, conn = await _server(session_override, name)
    args = {"server_name": name, "tool_name": "search", "arguments": {"query": "deck"}}

    fake_mcp.token = "new"
    out = await call_mcp_tool(session_override, tenant_id, args)
    assert "result" in out, out
    await session_override.refresh(server)
    assert json.loads(server.auth_json)["access_token"] == "new"

    fake_mcp.token = "newer"
    fake_mcp.refresh_ok = False
    out = await call_mcp_tool(session_override, tenant_id, args)
    assert out.get("needs_reconnect") is True
    assert "connected again" in out["error"]
    await session_override.refresh(conn)
    assert json.loads(conn.metadata_json)["health"]["status"] == "needs_reconnect"


def test_sse_body_picks_the_answer_to_the_request():
    from app.services.mcp_remote_client import parse_rpc_body

    note = {"jsonrpc": "2.0", "method": "notifications/progress"}
    answer = {"jsonrpc": "2.0", "id": "x-1", "result": {"ok": True}}
    response = httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        text=f"data: {json.dumps(note)}\n\ndata: {json.dumps(answer)}\n\n",
    )
    assert parse_rpc_body(response, "x-1") == answer
