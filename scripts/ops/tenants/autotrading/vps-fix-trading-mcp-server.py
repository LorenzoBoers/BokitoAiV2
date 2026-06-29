#!/usr/bin/env python3
"""Point Trading pipeline MCP at the real trading-exec-mcp URL (fix mock:// on prod)."""
from __future__ import annotations

import json
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
MCP_URL = os.environ.get("TRADING_MCP_URL", "http://trading-exec-mcp:8002/mcp")
MCP_KEY = os.environ.get("TRADING_MCP_API_KEY", "local-dev-key")
MCP_NAME = os.environ.get("TRADING_MCP_NAME", "Trading pipeline MCP")

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
import json
import os
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.integration import McpServer

MCP_NAME = {MCP_NAME!r}
MCP_URL = {MCP_URL!r}
MCP_KEY = {MCP_KEY!r}

async def main():
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))
        ).scalar_one()
        servers = (
            await session.execute(
                select(McpServer).where(McpServer.tenant_id == tenant.id)
            )
        ).scalars().all()
        target = None
        for s in servers:
            if s.name == MCP_NAME:
                target = s
                break
        if not target:
            print("MCP server not found:", MCP_NAME)
            return
        old_url = target.server_url
        target.server_url = MCP_URL
        target.auth_json = json.dumps({{"api_key": MCP_KEY, "auth_type": "api_key"}})
        session.add(target)
        await session.commit()
        print("updated", MCP_NAME, "from", old_url, "to", MCP_URL)

        alias = (
            await session.execute(
                select(McpServer).where(
                    McpServer.tenant_id == tenant.id,
                    McpServer.name == "mmxm-trading",
                )
            )
        ).scalar_one_or_none()
        if alias:
            alias.server_url = MCP_URL
            alias.auth_json = target.auth_json
            session.add(alias)
        else:
            session.add(
                McpServer(
                    tenant_id=tenant.id,
                    name="mmxm-trading",
                    server_url=MCP_URL,
                    auth_json=target.auth_json,
                )
            )
        await session.commit()
        print("ensured alias mmxm-trading ->", MCP_URL)

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
