#!/usr/bin/env python3
"""Smoke test report webhook and verify OperationalOutcome row on prod."""
import json
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
set -a
source /opt/trading/.env
set +a
docker compose -p trading exec -T worker python <<'PY'
import json, os, urllib.request
base = os.environ["BOKITO_BASE_URL"].rstrip("/")
trigger = os.environ["BOKITO_TRIGGER_ID"]
secret = os.environ["BOKITO_WEBHOOK_SECRET"]
payload = {"kind": "report", "subtype": "session_summary", "notes": "validation smoke", "pnl_r": 0.5}
req = urllib.request.Request(
    f"{base}/api/hooks/{trigger}",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json", "X-Bokito-Secret": secret},
    method="POST",
)
with urllib.request.urlopen(req, timeout=90) as resp:
    print("webhook", resp.status, resp.read().decode()[:300])
PY
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from sqlalchemy import select, func
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.outcome import OperationalOutcome

async def main():
    async with async_session_factory() as session:
        t = (await session.execute(select(Tenant).where(Tenant.slug=="autotrading"))).scalar_one()
        n = (await session.execute(select(func.count()).select_from(OperationalOutcome).where(OperationalOutcome.tenant_id==t.id))).scalar_one()
        print("outcomes_total", n)
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
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    client.close()
    return 0 if "outcomes_total" in out and "webhook 200" in out.replace("webhook", "webhook") else 1


if __name__ == "__main__":
    raise SystemExit(main())
