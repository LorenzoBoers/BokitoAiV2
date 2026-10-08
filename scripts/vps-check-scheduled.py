#!/usr/bin/env python3
"""List stuck scheduled outbound messages on prod."""
import os
import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from datetime import datetime
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.signal import SignalMessage

async def main():
    async with async_session_factory() as session:
        rows = (await session.execute(
            select(SignalMessage).where(SignalMessage.send_status == "scheduled")
            .order_by(SignalMessage.created_at.desc()).limit(30)
        )).scalars().all()
        print("scheduled count (sample):", len(rows), "now=", datetime.utcnow())
        for m in rows:
            print(m.created_at, m.send_after, m.signal_id, (m.body_preview or "")[:60])
asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    print(stdout.read().decode(errors="replace"), end="")
    print(stderr.read().decode(errors="replace")[-1500:], end="")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
