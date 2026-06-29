#!/usr/bin/env python3
"""Fire a decide webhook with all_passed=true to test live order path (expect AM window block)."""
from __future__ import annotations

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
import json
import os
import urllib.request

base = os.environ["BOKITO_BASE_URL"].rstrip("/")
trigger = os.environ["BOKITO_TRIGGER_ID"]
secret = os.environ["BOKITO_WEBHOOK_SECRET"]
payload = {
    "kind": "decide",
    "tenant_slug": "autotrading",
    "symbol": "NQ1!",
    "session": "am",
    "direction": "long",
    "setup_state_id": "live-path-smoke",
    "trade_plan_id": "plan-smoke-1",
    "passed_count": 3,
    "all_passed": True,
    "ts": "live-path-smoke",
}
req = urllib.request.Request(
    f"{base}/api/hooks/{trigger}",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json", "X-Bokito-Secret": secret},
    method="POST",
)
with urllib.request.urlopen(req, timeout=180) as resp:
    print("status", resp.status)
    print(resp.read().decode()[:2000])
PY

echo '--- agent run output ---'
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.agent import AgentRun
from app.models.signal import SignalMessage
from uuid import UUID

THREAD = UUID("847c0b0e-6bd3-440b-a352-bd1c32701667")

async def main():
    async with async_session_factory() as session:
        run = (
            await session.execute(
                select(AgentRun).order_by(AgentRun.started_at.desc()).limit(1)
            )
        ).scalar_one()
        print("latest_run:", run.id, run.status, run.subject)
        msgs = (
            await session.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == THREAD)
                .order_by(SignalMessage.created_at.desc())
                .limit(3)
            )
        ).scalars().all()
        for m in msgs:
            print("msg:", (m.body or "")[:500])

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=240)
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
