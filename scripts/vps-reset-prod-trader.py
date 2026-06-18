#!/usr/bin/env python3
"""Reset trader@bokito.ai password on production VPS (one-off ops)."""
from __future__ import annotations

import base64
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
EMAIL = os.environ.get("TRADER_EMAIL", "trader@bokito.ai")
NEW_PASSWORD = os.environ.get("TRADER_NEW_PASSWORD", "BokitoProd-Trader-2026!")

PY = f"""
import asyncio
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import User
from app.services.auth import hash_password

async def main():
    async with async_session_factory() as session:
        result = await session.execute(select(User).where(User.email == {EMAIL!r}))
        user = result.scalar_one_or_none()
        if not user:
            print("user_not_found")
            return
        user.password_hash = hash_password({NEW_PASSWORD!r})
        await session.commit()
        print("password_reset_ok")

asyncio.run(main())
"""

B64 = base64.b64encode(PY.encode()).decode()

REMOTE = (
    "docker compose -p bokito --env-file /opt/bokito/.env.prod "
    "-f /opt/bokito/docker-compose.deploy.yml -f /opt/bokito/docker-compose.vps.yml "
    f"exec -T api sh -c \"echo {B64} | base64 -d | python\""
)


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    client.close()
    if code == 0 and "password_reset_ok" in out:
        print(f"Login: {EMAIL} / {NEW_PASSWORD}")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
