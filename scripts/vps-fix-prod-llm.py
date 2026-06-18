#!/usr/bin/env python3
"""Refresh prod model catalog IDs and sync env Anthropic key to platform_secrets."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from sqlalchemy import text
from app.config import get_settings
from app.db.session import async_session_factory
from app.services.model_catalog import seed_model_catalog
from app.services import platform_secrets

UPDATES = [
    ("claude-sonnet-4", "claude-sonnet-4-6", "claude-sonnet-4-6", "Claude Sonnet 4.6"),
    ("claude-haiku-4", "claude-haiku-4-5-20251001", "claude-haiku-4-5", "Claude Haiku 4.5"),
    ("claude-opus-4", "claude-opus-4-8", "claude-opus-4-8", "Claude Opus 4.8"),
]

async def main():
    settings = get_settings()
    async with async_session_factory() as session:
        await seed_model_catalog(session)
        for old_slug, model_id, new_slug, display_name in UPDATES:
            await session.execute(
                text(
                    "UPDATE model_catalog SET slug = :new_slug, model_id = :model_id, "
                    "display_name = :display_name WHERE slug = :old_slug"
                ),
                {
                    "old_slug": old_slug,
                    "new_slug": new_slug,
                    "model_id": model_id,
                    "display_name": display_name,
                },
            )
        await session.commit()
        print("catalog model ids refreshed")
        if settings.anthropic_api_key:
            await platform_secrets.set_platform_secret(session, "anthropic", settings.anthropic_api_key)
            print("platform anthropic key synced from env")
        else:
            print("no env anthropic key to sync")
        status = await platform_secrets.list_platform_status(session)
        print("platform_secrets:", status)

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
