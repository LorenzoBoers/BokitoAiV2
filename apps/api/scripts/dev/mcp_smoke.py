"""Smoke-test the connections of one workspace: a list call and a read call each.

For every active MCP server (remote, native, partner) the script lists the
tools, then calls the first read-only tool that needs no arguments. Google
Drive (the documents module) gets a ``list`` call. It prints one line per
connection with ok or the error, and exits 1 when any failed.

Usage (on the dev box):
    PYTHONPATH=. ./.venv/bin/python scripts/dev/mcp_smoke.py --slug lotsofcontent
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import select  # noqa: E402

from app.db.session import async_session_factory  # noqa: E402
from app.models.auth import Tenant  # noqa: E402
from app.models.integration import IntegrationConnection, McpServer  # noqa: E402


def _read_tool(tools: list[dict[str, Any]]) -> str | None:
    for tool in tools:
        hints = tool.get("annotations") or {}
        schema = tool.get("input_schema") or {}
        if hints.get("readOnlyHint") and not hints.get("destructiveHint") and not schema.get("required"):
            return str(tool["name"])
    return None


def _error_of(result: dict[str, Any]) -> str:
    if result.get("error"):
        return str(result["error"])[:200]
    inner = result.get("result")
    if isinstance(inner, dict) and inner.get("isError"):
        return json.dumps(inner)[:200]
    return ""


async def smoke(slug: str) -> int:
    from app.modules.documents.router import call_verb
    from app.services.agent.mcp_client import call_mcp_tool
    from app.services.integrations_platform import test_mcp_server

    failed = 0
    async with async_session_factory() as session:
        tenant = (await session.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
        if tenant is None:
            print(f"no workspace {slug}")
            return 1
        servers = (
            await session.execute(
                select(McpServer).where(McpServer.tenant_id == tenant.id, McpServer.is_active.is_(True))
            )
        ).scalars().all()
        for server in servers:
            try:
                listed = await test_mcp_server(session, tenant.id, server.id)
            except Exception as exc:  # noqa: BLE001 — report and go on
                listed = {"ok": False, "error": str(exc)}
            if not listed.get("ok"):
                failed += 1
                print(f"FAIL {server.name}: list: {str(listed.get('error') or listed)[:200]}")
                continue
            tools = listed.get("tools") or []
            tool = _read_tool(tools)
            if tool is None:
                print(f"ok   {server.name}: {len(tools)} tools, no read tool without arguments")
                continue
            try:
                result = await call_mcp_tool(
                    session, tenant.id, {"server_name": server.name, "tool_name": tool, "arguments": {}}
                )
            except Exception as exc:  # noqa: BLE001
                result = {"error": str(exc)}
            error = _error_of(result)
            if error:
                failed += 1
                print(f"FAIL {server.name}: {tool}: {error}")
            else:
                print(f"ok   {server.name}: {len(tools)} tools, {tool} answered")

        drive = (
            await session.execute(
                select(IntegrationConnection).where(
                    IntegrationConnection.tenant_id == tenant.id,
                    IntegrationConnection.provider == "google_drive",
                    IntegrationConnection.status == "active",
                )
            )
        ).scalars().first()
        if drive is not None:
            result = await call_verb(session, tenant.id, "list", {"page_size": 5})
            if result.get("ok"):
                print("ok   Google Drive: list answered")
            else:
                failed += 1
                print(f"FAIL Google Drive: {result.get('error') or result}")
        await session.commit()
    print(f"{len(servers) + (1 if drive else 0)} connections, {failed} failed")
    return 1 if failed else 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--slug", required=True)
    args = parser.parse_args()
    raise SystemExit(asyncio.run(smoke(args.slug)))


if __name__ == "__main__":
    main()
