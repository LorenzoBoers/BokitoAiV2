#!/usr/bin/env python3
"""Audit trader autonomy, triggers, and MCP server on prod."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = """
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
import json
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.agent import Agent
from app.models.trigger import Trigger
from app.models.integration import McpServer

async def main():
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))
        ).scalar_one()
        trader = await session.get(Agent, UUID("e1728c7f-f06d-4ea3-bbe7-1f7781ee9c25"))
        print("trader:", {
            "autonomy_level": trader.autonomy_level,
            "max_loops": trader.max_loops,
            "tools_json": trader.tools_json[:80] if trader.tools_json else None,
        })
        triggers = (
            await session.execute(select(Trigger).where(Trigger.tenant_id == tenant.id))
        ).scalars().all()
        print("triggers:")
        for t in triggers:
            print(
                f"  - {t.name} kind={t.kind} enabled={t.enabled} "
                f"agent_id={t.agent_id} id={t.id}"
            )
        mcps = (
            await session.execute(select(McpServer).where(McpServer.tenant_id == tenant.id))
        ).scalars().all()
        print("mcp_servers:")
        for m in mcps:
            auth = json.loads(m.auth_json or "{}")
            print(f"  {m.name} url={m.server_url} auth_keys={list(auth.keys())}")

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
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
