#!/usr/bin/env python3
"""Print the effective Bokito tier backings (and where each comes from) on prod."""
import os

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = """
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, os
from app.db.session import async_session_factory
from app.services import bokito_models

async def main():
    print("BOKITO_BACKINGS env:", repr(os.environ.get("BOKITO_BACKINGS", "")))
    async with async_session_factory() as session:
        routes = await bokito_models.refresh_routes(session, force=True)
    sources = bokito_models.route_sources()
    for slug, chain in routes.items():
        print(slug, sources.get(slug), list(chain))

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    print(stdout.read().decode(errors="replace"), end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err[-2000:])
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
