#!/usr/bin/env python3
"""Inspect trading worker logs and recent Bokito agent runs for decide webhooks."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
TRADER_ID = "e1728c7f-f06d-4ea3-bbe7-1f7781ee9c25"

REMOTE = f"""
echo '=== trading worker logs (bokito/webhook/decide) ==='
docker compose -p trading logs worker --tail 120 2>&1 | grep -iE 'bokito|webhook|decide|setup|scan|error' | tail -40 || true

echo '=== trading .env BOKITO ==='
grep '^BOKITO_' /opt/trading/.env || true

echo '=== recent agent runs (MMXM Trader) ==='
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.agent import AgentRun

TRADER_ID = UUID("{TRADER_ID}")

async def main():
    async with async_session_factory() as session:
        runs = (
            await session.execute(
                select(AgentRun)
                .where(AgentRun.agent_id == TRADER_ID)
                .order_by(AgentRun.started_at.desc())
                .limit(8)
            )
        ).scalars().all()
        for r in runs:
            print(
                f"{{r.started_at}} trigger={{r.trigger_type}} subject={{r.subject[:60]!r}} "
                f"status={{r.status}} id={{r.id}}"
            )

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
