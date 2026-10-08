#!/usr/bin/env python3
"""Dry-run / real SMTP probe for the mailbox on a prod thread (no message saved)."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
THREAD_ID = sys.argv[1]
TO = sys.argv[2] if len(sys.argv) > 2 else ""
DO_SEND = os.environ.get("DO_SEND", "0") == "1"

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json
from uuid import UUID
from app.db.session import async_session_factory
from app.models.signal import Signal
from app.models.channel import ChannelAccount
from app.services.crypto import get_connection_credentials
from app.services.smtp_imap import verify_mailbox, send_smtp

THREAD_ID = UUID("{THREAD_ID}")
TO = {TO!r}
DO_SEND = {str(DO_SEND)}

async def main():
    async with async_session_factory() as session:
        s = await session.get(Signal, THREAD_ID)
        acct = await session.get(ChannelAccount, s.channel_account_id)
        creds = get_connection_credentials(acct) or {{}}
        safe = {{k: (v if k != "password" else ("***" if v else "")) for k, v in creds.items()}}
        print("account:", acct.address, acct.provider, acct.status if hasattr(acct,"status") else "")
        print("creds:", json.dumps(safe, default=str))
        try:
            verified = await verify_mailbox(creds)
            print("verify: ok", {{k: verified.get(k) for k in ("imap_host","smtp_host","smtp_port","verified_at") if k in verified}})
        except Exception as exc:
            print("verify: FAIL", type(exc).__name__, exc)
            return
        if DO_SEND and TO:
            status = await send_smtp(
                acct,
                to_address=TO,
                subject="Bokito SMTP probe (ignore)",
                body_text="Probe from Bokito ops. Safe to ignore.",
                body_html="<p>Probe from Bokito ops. Safe to ignore.</p>",
            )
            print("send_status:", status)
        else:
            print("send: skipped (set DO_SEND=1 and pass recipient to send a probe)")

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=180)
    print(stdout.read().decode(errors="replace"), end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err[-2500:], file=sys.stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
