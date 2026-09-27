"""Quick live smoke against a running API (dev only).

Covers discovery, OAuth well-known, bearer MCP tools, and GET SSE.
"""

from __future__ import annotations

import asyncio
import sys

import httpx

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    async with httpx.AsyncClient(base_url=base, timeout=30.0) as client:
        prm = await client.get("/api/oauth/.well-known/oauth-protected-resource")
        if prm.status_code != 200:
            print("prm failed", prm.status_code, prm.text[:200])
            return 1
        print("prm resource=", prm.json().get("resource"))

        as_meta = await client.get("/api/oauth/.well-known/openid-configuration")
        if as_meta.status_code != 200:
            print("as meta failed", as_meta.status_code)
            return 1
        print("issuer=", as_meta.json().get("issuer"))

        sse = await client.get("/api/mcp", headers={"Accept": "text/event-stream"})
        print("get sse", sse.status_code, "endpoint" in sse.text)

        login = await client.post(
            "/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        if login.status_code != 200:
            print("login failed", login.status_code, login.text[:200])
            return 1
        auth = {"Authorization": f"Bearer {login.json()['access_token']}"}
        tok = await client.post(
            "/api/govern/tokens",
            headers=auth,
            json={"name": "mcp-smoke", "scopes": ["workspace", "messaging"]},
        )
        if tok.status_code != 200:
            print("token failed", tok.status_code, tok.text[:200])
            return 1
        plain = tok.json()["token"]
        mcp_headers = {
            "Authorization": f"Bearer {plain}",
            "Content-Type": "application/json",
        }
        init = await client.post(
            "/api/mcp",
            headers=mcp_headers,
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize"},
        )
        info = init.json()["result"]["serverInfo"]
        print(
            "initialize",
            init.status_code,
            info.get("name"),
            info.get("version"),
            "session=",
            bool(init.headers.get("mcp-session-id")),
        )
        listed = await client.post(
            "/api/mcp",
            headers=mcp_headers,
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        )
        tools = listed.json()["result"]["tools"]
        names = {t["name"] for t in tools}
        annotated = sum(1 for t in tools if t.get("annotations"))
        print(
            "tools",
            len(names),
            "annotated=",
            annotated,
            "list_contacts=",
            "list_contacts" in names,
            "search_index=",
            "search_index" in names,
            "create_agent=",
            "create_agent" in names,
        )
        call = await client.post(
            "/api/mcp",
            headers=mcp_headers,
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "search_index", "arguments": {"query": "test"}},
            },
        )
        body = call.json()["result"]
        print("search_index isError=", body.get("isError"))

        grants = await client.get("/api/oauth/grants", headers=auth)
        print("grants", grants.status_code, "count=", len(grants.json().get("items", [])))
        return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
