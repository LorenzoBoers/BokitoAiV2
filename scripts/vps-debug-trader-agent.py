#!/usr/bin/env python3
"""Inspect MMXM Trader agent + recent API logs on production."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
AGENT_ID = "e1728c7f-f06d-4ea3-bbe7-1f7781ee9c25"
THREAD_ID = "847c0b0e-6bd3-440b-a352-bd1c32701667"

REMOTE = rf"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.agent import Agent
from app.models.signal import Signal, SignalMessage

AGENT_ID = UUID("{AGENT_ID}")
THREAD_ID = UUID("{THREAD_ID}")

async def main():
    async with async_session_factory() as session:
        agent = await session.get(Agent, AGENT_ID)
        if not agent:
            print("agent: NOT FOUND")
            return
        print("agent:", {{
            "name": agent.name,
            "is_active": agent.is_active,
            "runtime_status": agent.runtime_status,
            "model": agent.model,
            "role": agent.role,
            "kind": agent.kind,
        }})
        signal = await session.get(Signal, THREAD_ID)
        if signal:
            print("signal:", {{
                "channel": signal.channel,
                "ai_paused": signal.ai_paused,
                "assigned_agent_id": str(signal.assigned_agent_id) if signal.assigned_agent_id else None,
            }})
            msgs = await session.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == THREAD_ID)
                .order_by(SignalMessage.created_at.desc())
                .limit(5)
            )
            print("recent_messages:")
            for m in reversed(msgs.scalars().all()):
                print(f"  - {{m.direction}} {{m.author_type}}: {{(m.body or '')[:120]!r}}")

asyncio.run(main())
PY
echo '--- api logs (agent reply) ---'
docker compose -p bokito logs api --tail 80 2>&1 | grep -iE 'agent reply|Failed to generate|anthropic|MMXM|847c0b0e' || true
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
