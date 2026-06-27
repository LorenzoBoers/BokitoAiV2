#!/usr/bin/env python3
"""Deploy local API code to prod via rsync + docker compose rebuild."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
LOCAL_ROOT = os.environ.get("BOKITO_LOCAL_ROOT", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")))

REMOTE_DEPLOY = """
set -euo pipefail
cd /opt/bokito
for svc in api worker; do
  cid=$(docker compose -p bokito ps -q $svc)
  tar -C apps/api -cf - app scripts | docker cp - "$cid":/app/
  docker cp apps/api/app/. "$cid":/app/app/
  docker cp apps/api/scripts/. "$cid":/app/scripts/
done
docker compose -p bokito restart api worker
sleep 15
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
echo deploy_done
"""


def rsync_api(client: paramiko.SSHClient) -> None:
    """Tar local apps/api and extract on VPS (simple rsync substitute)."""
    import subprocess
    import tempfile

    tar_path = tempfile.mktemp(suffix=".tar.gz")
    api_dir = os.path.join(LOCAL_ROOT, "apps", "api")
    subprocess.check_call(
        ["tar", "-czf", tar_path, "-C", api_dir, "app", "scripts", "pyproject.toml"],
        shell=False,
    )
    sftp = client.open_sftp()
    remote_tar = "/tmp/bokito-api-sync.tar.gz"
    sftp.put(tar_path, remote_tar)
    sftp.close()
    os.remove(tar_path)
    _, stdout, stderr = client.exec_command(
        f"cd /opt/bokito/apps/api && tar -xzf {remote_tar} && rm {remote_tar}",
        timeout=120,
    )
    stdout.channel.recv_exit_status()
    err = stderr.read().decode()
    if err.strip():
        print(err, file=sys.stderr)


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    print("Syncing apps/api to VPS...")
    rsync_api(client)
    print("Rebuilding api/worker containers...")
    _, stdout, stderr = client.exec_command(REMOTE_DEPLOY, timeout=600)
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
