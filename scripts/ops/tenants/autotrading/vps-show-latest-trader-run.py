#!/usr/bin/env python3
"""Show latest MMXM Trader webhook run result and Messages thread."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = """
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.agent import AgentRun
from app.models.signal import SignalMessage

THREAD = UUID("847c0b0e-6bd3-440b-a352-bd1c32701667")

async def main():
    async with async_session_factory() as session:
        run = (
            await session.execute(
                select(AgentRun)
                .where(AgentRun.trigger_type == "trigger_webhook")
                .order_by(AgentRun.started_at.desc())
                .limit(1)
            )
        ).scalar_one()
        print("run_id:", run.id)
        print("status:", run.status)
        print("result_json:", (run.result_json or "")[:2000])
        msgs = (
            await session.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == THREAD)
                .order_by(SignalMessage.created_at.desc())
                .limit(3)
            )
        ).scalars().all()
        print("--- messages ---")
        for m in msgs:
            print(f"{m.created_at} {m.role}: {(m.body_text or '')[:800]}")

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
