#!/usr/bin/env python3
"""Seed trading workspace docs and set MMXM Trader as default chat agent on prod autotrading tenant."""
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
from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.auth import Tenant
from scripts.tenants.autotrading.bootstrap import seed_trading_stack

async def main():
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))
        ).scalar_one()
        result = await seed_trading_stack(session, tenant.id)
        print(json.dumps(result, indent=2))

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=180)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    if out.strip():
        print(out.strip())
    if err.strip():
        print(err.strip(), file=sys.stderr)
    return 0 if stdout.channel.recv_exit_status() == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
