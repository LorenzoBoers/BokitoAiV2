#!/usr/bin/env python3
"""Fetch recent messages for a prod signal thread."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
THREAD_ID = sys.argv[1] if len(sys.argv) > 1 else "847c0b0e-6bd3-440b-a352-bd1c32701667"

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.signal import SignalMessage

THREAD_ID = UUID("{THREAD_ID}")

async def main():
    async with async_session_factory() as session:
        msgs = await session.execute(
            select(SignalMessage)
            .where(SignalMessage.signal_id == THREAD_ID)
            .order_by(SignalMessage.created_at.desc())
            .limit(6)
        )
        for m in reversed(msgs.scalars().all()):
            print(f"[{{m.direction}}] {{m.kind}} {{m.role}}: {{(m.body_text or '')[:200]}}")

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    print(stdout.read().decode(), end="")
    err = stderr.read().decode()
    if err:
        print(err, file=sys.stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
