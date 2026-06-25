#!/usr/bin/env python3
"""Install trading MCP (custom_mcp) on prod when TRADING_MCP_* env vars are set."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
TENANT_SLUG = os.environ.get("TENANT_SLUG", "autotrading")

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
import os
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.integration import IntegrationConnection
from app.services.integrations_platform import install_mcp

URL = (os.environ.get("TRADING_MCP_URL") or "").strip()
KEY = (os.environ.get("TRADING_MCP_API_KEY") or "local-dev-key").strip()

async def main():
    if not URL:
        print("TRADING_MCP_URL not set on api container; skip MCP install")
        return
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "{TENANT_SLUG}"))
        ).scalar_one_or_none()
        if not tenant:
            print("tenant not found")
            return
        existing = await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.tenant_id == tenant.id,
                IntegrationConnection.provider == "custom_mcp",
            )
        )
        if existing.scalar_one_or_none():
            print("custom_mcp already installed")
            return
        result = await install_mcp(
            session,
            tenant.id,
            provider="custom_mcp",
            api_key=KEY,
            display_name="Trading pipeline MCP",
            server_url=URL,
            auth_type="api_key",
        )
        print("installed", result["connection"]["id"])

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
