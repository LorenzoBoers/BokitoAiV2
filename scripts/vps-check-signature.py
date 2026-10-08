#!/usr/bin/env python3
"""Inspect signature sources for a prod thread's outbound mail."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
THREAD_ID = sys.argv[1]

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json, re
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.signal import Signal, SignalMessage
from app.models.channel import ChannelAccount
from app.models.auth import User, Membership
from app.services.signatures import resolve_signature_html, resolve_from_display_name

THREAD_ID = UUID("{THREAD_ID}")

async def main():
    async with async_session_factory() as session:
        s = await session.get(Signal, THREAD_ID)
        print("signal account:", s.channel_account_id)
        acct = await session.get(ChannelAccount, s.channel_account_id) if s.channel_account_id else None
        if acct:
            settings = {{}}
            try:
                settings = json.loads(acct.settings_json or "{{}}")
            except Exception:
                pass
            sig = settings.get("signature_html") or settings.get("email_signature_html") or ""
            print("account:", acct.address, "sig_len:", len(sig or ""))
            if sig:
                print("account_sig_preview:", re.sub(r"\\s+", " ", sig)[:400])
                print("account_has_img:", "<img" in (sig or "").lower())
        # latest outbound
        msgs = (await session.execute(
            select(SignalMessage).where(
                SignalMessage.signal_id == THREAD_ID,
                SignalMessage.direction == "outbound",
            ).order_by(SignalMessage.created_at.desc()).limit(3)
        )).scalars().all()
        for m in msgs:
            html = m.body_html or ""
            print("--- msg", m.id, m.created_at, "send=", m.send_status, "html_len=", len(html))
            print("imgs:", re.findall(r"<img[^>]{{0,200}}>", html, flags=re.I)[:5])
            # author
            if m.author_user_id:
                u = await session.get(User, m.author_user_id)
                print("author:", u.email if u else None, "user_id", m.author_user_id)
                # user signature fields if any
                for attr in ("email_signature_html", "signature_html", "settings_json"):
                    if hasattr(u, attr):
                        val = getattr(u, attr)
                        print(" user."+attr+":", (str(val) or "")[:200])
                sig = await resolve_signature_html(
                    session, s.tenant_id, send_as="user", user_id=m.author_user_id
                )
                print("resolved_sig_len:", len(sig or ""), "has_img:", "<img" in (sig or "").lower())
                if sig:
                    print("resolved_preview:", re.sub(r"\\s+", " ", sig)[:500])

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
        print(err[-2000:], file=sys.stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
