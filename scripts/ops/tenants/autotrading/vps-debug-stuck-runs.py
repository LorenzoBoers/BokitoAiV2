#!/usr/bin/env python3
"""Inspect stuck MMXM Trader runs and recent API errors."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json
from sqlalchemy import select, desc
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.agent import Agent, AgentRun, RunEvent
from app.models.trigger import Trigger

async def main():
    async with async_session_factory() as session:
        tenant = (await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))).scalar_one()
        trader = (await session.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.name == "MMXM Trader")
        )).scalar_one()
        runs = (await session.execute(
            select(AgentRun).where(AgentRun.agent_id == trader.id).order_by(desc(AgentRun.started_at)).limit(8)
        )).scalars().all()
        for r in runs:
            print(f"RUN {r.id} status={r.status} trigger={r.trigger_type} subject={r.subject!r}")
            print(f"  started={r.started_at} completed={r.completed_at}")
            print(f"  result={ (r.result_json or '')[:300] }")
            evs = (await session.execute(
                select(RunEvent).where(RunEvent.run_id == r.id).order_by(RunEvent.sequence).limit(12)
            )).scalars().all()
            for e in evs:
                print(f"  evt {e.sequence} {e.event_type}: {e.message[:160]}")
        for t in (await session.execute(select(Trigger).where(Trigger.tenant_id == tenant.id))).scalars():
            if "scan" in t.name.lower() or "digest" in t.name.lower() or "weekly" in t.name.lower():
                print(f"TRIGGER {t.name} last_status={t.last_status!r} last_run={t.last_run_at} next={t.next_run_at}")
asyncio.run(main())
PY
docker compose -p bokito logs api --tail 60 2>&1 | grep -iE 'error|MMXM|agent reply|Failed|anthropic|tool' || true
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err.strip():
        print(err, file=sys.stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
