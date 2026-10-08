#!/usr/bin/env python3
"""Inspect outbound send_status + mailbox for a prod thread."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
THREAD_ID = sys.argv[1]

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.signal import Signal, SignalMessage

THREAD_ID = UUID("{THREAD_ID}")

async def main():
    async with async_session_factory() as session:
        s = await session.get(Signal, THREAD_ID)
        if not s:
            print("NOT FOUND"); return
        cols = {{c.name: getattr(s, c.name, None) for c in s.__table__.columns}}
        keep = [
            "channel", "source", "status", "subject", "contact_email", "contact_name",
            "connection_id", "channel_account_id", "agent_id", "tenant_id", "ai_handling",
        ]
        print("signal:", json.dumps({{k: str(cols[k]) for k in keep if k in cols}}, ensure_ascii=False))
        msgs = (
            await session.execute(
                select(SignalMessage)
                .where(SignalMessage.signal_id == THREAD_ID)
                .order_by(SignalMessage.created_at.desc())
                .limit(20)
            )
        ).scalars().all()
        print("--- messages ---")
        for m in msgs:
            print(json.dumps({{
                "at": str(m.created_at),
                "dir": m.direction,
                "kind": m.kind,
                "send_status": m.send_status,
                "to": m.to_addresses,
                "from": m.from_address,
                "preview": (m.body_preview or m.body_text or "")[:120],
                "id": str(m.id),
                "meta": (m.metadata_json or "")[:200],
            }}, ensure_ascii=False))
        # Look up mailbox if present
        acct_id = cols.get("channel_account_id") or cols.get("connection_id")
        if acct_id:
            from app.models.channel import ChannelAccount
            acct = await session.get(ChannelAccount, acct_id)
            if acct:
                acols = {{c.name: getattr(acct, c.name, None) for c in acct.__table__.columns}}
                print("account:", json.dumps({{
                    k: str(acols.get(k))
                    for k in ("id", "provider", "email", "address", "status", "kind", "display_name")
                    if k in acols
                }}, ensure_ascii=False))

asyncio.run(main())
PY
echo '--- api logs (send/smtp/mail) ---'
docker compose -p bokito logs api --since 48h --tail 5000 2>&1 | grep -iE '{THREAD_ID[:8]}|smtp|send.*fail|deliver_outbound|auth_expired|no_credentials' | tail -60 || true
echo '--- worker logs ---'
docker compose -p bokito logs worker --since 48h --tail 3000 2>&1 | grep -iE '{THREAD_ID[:8]}|smtp|deliver' | tail -40 || true
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=240)
    print(stdout.read().decode(errors="replace"), end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err[-3000:], file=sys.stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
