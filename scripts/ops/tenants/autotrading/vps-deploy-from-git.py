#!/usr/bin/env python3
"""Git pull on VPS and rebuild prod api/worker from source."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
BRANCH = os.environ.get("DEPLOY_BRANCH", "main")

REMOTE = f"""
set -euo pipefail
cd /opt/bokito
git fetch origin {BRANCH}
git checkout {BRANCH}
git pull --ff-only origin {BRANCH} || true
export BOKITO_ENV_FILE=.env.prod
docker compose -p bokito -f docker-compose.deploy.yml build api worker
docker compose -p bokito -f docker-compose.deploy.yml up -d api worker
docker compose -p bokito exec -T api python -c "import asyncio; from app.db.session import init_db; asyncio.run(init_db())"
docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from scripts.tenants.autotrading.bootstrap import seed_trading_stack

async def main():
    async with async_session_factory() as session:
        tenant = (await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))).scalar_one()
        print(await seed_trading_stack(session, tenant.id, link_signal_id=UUID("847c0b0e-6bd3-440b-a352-bd1c32701667")))
asyncio.run(main())
PY
echo deploy_ok
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=900)
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
