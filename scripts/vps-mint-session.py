#!/usr/bin/env python3
"""Mint a short-lived prod access token for the author of a thread's first message.

Used for supervised QA in the browser on behalf of that user. The token is
written to a local file outside the repo and never printed.
"""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
THREAD_ID = sys.argv[1]
OUT = os.path.expanduser(os.environ.get("TOKEN_OUT", "~/.bokito_qa_token"))

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import User
from app.models.signal import Signal, SignalMessage
from app.services.auth import create_access_token

async def main():
    async with async_session_factory() as session:
        s = await session.get(Signal, UUID("{THREAD_ID}"))
        msg = (await session.execute(select(SignalMessage).where(
            SignalMessage.signal_id == s.id, SignalMessage.author_user_id.is_not(None)
        ).order_by(SignalMessage.created_at).limit(1))).scalar_one()
        user = await session.get(User, msg.author_user_id)
        print("USER", user.email)
        print("TOKEN", create_access_token(user.id, s.tenant_id, user.email))

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    out = stdout.read().decode(errors="replace")
    client.close()
    token = ""
    for line in out.splitlines():
        if line.startswith("USER "):
            print(line)
        if line.startswith("TOKEN "):
            token = line.split(" ", 1)[1].strip()
    if not token:
        print(out)
        print(stderr.read().decode(errors="replace"), file=sys.stderr)
        return 1
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(token)
    print("token written to", OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
