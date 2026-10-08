#!/usr/bin/env python3
"""Inspect a prod thread: signal state, recent messages + events, matching logs."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
THREAD_ID = sys.argv[1]
LOG_LINES = os.environ.get("LOG_LINES", "4000")

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.agent import Agent, AgentRun
from app.models.signal import Signal, SignalEvent, SignalMessage

THREAD_ID = UUID("{THREAD_ID}")

async def main():
    async with async_session_factory() as session:
        s = await session.get(Signal, THREAD_ID)
        if s is None:
            print("signal: NOT FOUND"); return
        print("signal:", dict(channel=s.channel, source=s.source, status=s.status,
              agent_id=str(s.agent_id), tenant_id=str(s.tenant_id),
              ai_handling=getattr(s, "ai_handling", None)))
        if s.agent_id:
            a = await session.get(Agent, s.agent_id)
            if a:
                print("agent:", dict(name=a.name, model=a.model, active=a.is_active, kind=a.kind))
        msgs = (await session.execute(select(SignalMessage).where(SignalMessage.signal_id == THREAD_ID)
                .order_by(SignalMessage.created_at.desc()).limit(14))).scalars().all()
        print("--- messages ---")
        for m in reversed(msgs):
            meta = (m.metadata_json or "")[:300]
            print(m.created_at, m.direction, m.kind, m.role, repr((m.body_text or "")[:90]), meta)
        evts = (await session.execute(select(SignalEvent).where(SignalEvent.signal_id == THREAD_ID)
                .order_by(SignalEvent.created_at.desc()).limit(20))).scalars().all()
        print("--- events ---")
        for e in reversed(evts):
            print(e.created_at, e.event_type, e.actor_type, (e.payload_json or "")[:300])
        try:
            runs = (await session.execute(select(AgentRun).where(AgentRun.signal_id == THREAD_ID)
                    .order_by(AgentRun.created_at.desc()).limit(6))).scalars().all()
            print("--- runs ---")
            for r in reversed(runs):
                print(r.created_at, r.status, (getattr(r, "error", "") or "")[:400])
        except Exception as exc:
            print("runs n/a:", exc)

asyncio.run(main())
PY
echo '--- api logs ---'
docker compose -p bokito logs api --since 12h --tail {LOG_LINES} 2>&1 | grep -iE '{THREAD_ID[:8]}|Traceback|Error|exception|rate limit' | tail -80 || true
echo '--- worker logs ---'
docker compose -p bokito logs worker --since 12h --tail {LOG_LINES} 2>&1 | grep -iE '{THREAD_ID[:8]}|Traceback|Error|exception|rate limit' | tail -60 || true
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=240)
    print(stdout.read().decode(errors="replace"), end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err, file=sys.stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
