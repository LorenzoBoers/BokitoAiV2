#!/usr/bin/env python3
"""Run trading stack bootstrap inside the prod API container."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
TENANT_SLUG = os.environ.get("TENANT_SLUG", "autotrading")
LINK_SIGNAL = os.environ.get("LINK_SIGNAL_ID", "847c0b0e-6bd3-440b-a352-bd1c32701667")

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from scripts.tenants.autotrading.bootstrap import seed_trading_stack

LINK = "{LINK_SIGNAL}".strip() or None
SIGNAL_ID = UUID(LINK) if LINK else None

async def main():
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "{TENANT_SLUG}"))
        ).scalar_one_or_none()
        if not tenant:
            print("tenant not found")
            return
        result = await seed_trading_stack(
            session, tenant.id, link_signal_id=SIGNAL_ID
        )
        print(result)

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
