#!/usr/bin/env python3
"""Show resolved AI handling (and breaker state) for a prod thread."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
THREAD_ID = sys.argv[1]

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.signal import Signal
from app.services import ai_handling

async def main():
    async with async_session_factory() as session:
        s = await session.get(Signal, UUID("{THREAD_ID}"))
        tenant = await session.get(Tenant, s.tenant_id)
        account, contact = await ai_handling.load_layers(session, s.tenant_id, s)
        h = ai_handling.resolve_ai_handling(tenant, account, contact, s)
        print("handling:", h)
        print("held:", ai_handling.is_held(s))
        for attr in ("ai_handling_json", "ai_paused", "settings_json"):
            if hasattr(s, attr):
                print(attr, "=", str(getattr(s, attr))[:400])
        print("breaker:", ai_handling.breaker_tripped_at(s) if hasattr(ai_handling, "breaker_tripped_at") else "n/a")

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=180)
    print(stdout.read().decode(errors="replace"), end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err, file=sys.stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
