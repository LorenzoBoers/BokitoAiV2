#!/usr/bin/env python3
"""Deep-dive outbound messages on Harold's thread."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.signal import Signal, SignalMessage
from app.models.channel import ChannelAccount

THREAD = UUID("ec4109b4-519c-49df-9be4-f73eaae72b9f")
OUTBOUND = UUID("8f122981-a51f-4b30-9ee8-15529e3065df")
EXTERNAL = UUID("704a91dc-5226-478e-8403-c3370c8be3ff")

async def main():
    async with async_session_factory() as session:
        s = await session.get(Signal, THREAD)
        print("signal contact_email=", s.contact_email, "channel_account_id=", s.channel_account_id)
        acct = await session.get(ChannelAccount, s.channel_account_id) if s.channel_account_id else None
        if acct:
            settings = (acct.settings_json or "")[:500]
            print("account", acct.provider, acct.address, "status=", getattr(acct, "status", None), "settings_head=", settings)

        for mid in (OUTBOUND, EXTERNAL):
            m = await session.get(SignalMessage, mid)
            print("\n====", mid)
            print("dir", m.direction, "kind", m.kind, "send_status", m.send_status)
            print("from_address", repr(m.from_address))
            print("to_addresses", repr(m.to_addresses))
            for attr in ("cc_addresses", "bcc_addresses", "external_id", "provider_message_id", "in_reply_to"):
                if hasattr(m, attr):
                    print(attr, repr(getattr(m, attr)))
            meta = m.metadata_json or ""
            print("meta_full", meta)
            print("body_text:\n", m.body_text or "")
            html = m.body_html or ""
            print("body_html_len", len(html))
            for needle in ("{{name}}", "{{company}}", "{{phone}}", "bokito-logo", "Met vriendelijke",
                           "border-radius", "Powered by", "mailto:", "data:image", "<img"):
                if needle in html or needle in (m.body_text or ""):
                    print("HAS", needle)
            print("--- html tail ---")
            print(html[-2000:])

asyncio.run(main())
PY
echo '--- api send logs for thread ---'
docker compose -p bokito logs api --since 72h --tail 15000 2>&1 | grep -iE 'ec4109b4|8f122981|send_reply|outlook|graph.*send|deliver_outbound|harold@bourgondien' | tail -80 || true
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=240)
    print(stdout.read().decode(errors="replace"), end="")
    err = stderr.read().decode(errors="replace")
    if err:
        print(err[-4000:], file=sys.stderr)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
