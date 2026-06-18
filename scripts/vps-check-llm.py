#!/usr/bin/env python3
"""Check LLM configuration inside the production API container."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && \
grep '^LLM_MODE=' .env.prod && \
docker compose -p bokito exec -T api python <<'PY'
import asyncio
from app.config import get_settings
from app.db.session import async_session_factory
from app.services import platform_secrets
from app.services.model_resolution import resolve_model_call
from sqlalchemy import select
from app.models.auth import Tenant

async def main():
    s = get_settings()
    print("llm_mode:", s.llm_mode)
    print("env_anthropic_set:", bool(s.anthropic_api_key))
    async with async_session_factory() as session:
        plat = await platform_secrets.list_platform_status(session)
        print("platform_secrets:", plat)
        row = await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))
        tenant = row.scalar_one_or_none()
        if tenant:
            resolved = await resolve_model_call(session, tenant.id, kind="chat")
            print("autotrading_resolve:", {
                "slug": resolved.slug,
                "key_source": resolved.key_source,
                "live": resolved.live,
                "model_id": resolved.model_id,
            })

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
    code = stdout.channel.recv_exit_status()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
