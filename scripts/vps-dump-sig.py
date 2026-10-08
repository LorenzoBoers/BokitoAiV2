#!/usr/bin/env python3
import os, sys, paramiko
HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY = os.path.expanduser(os.environ.get("VPS_SSH_KEY", "~/.ssh/bokito_vps_deploy"))
MSG = sys.argv[1]
REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json
from uuid import UUID
from app.db.session import async_session_factory
from app.models.signal import SignalMessage
from app.models.auth import User
from app.services.signatures import user_signature_html

async def main():
    async with async_session_factory() as session:
        m = await session.get(SignalMessage, UUID("{MSG}"))
        print("=== BODY_HTML ===")
        print(m.body_html or "")
        print("=== BODY_TEXT ===")
        print(m.body_text or "")
        u = await session.get(User, m.author_user_id)
        settings = json.loads(u.settings_json or "{{}}")
        print("=== USER email_signature_html ===")
        print(settings.get("email_signature_html") or "")
        print("=== user_signature_html() ===")
        print(user_signature_html(u))
asyncio.run(main())
PY
"""
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username="root", key_filename=KEY, timeout=30)
_, o, e = c.exec_command(REMOTE, timeout=120)
print(o.read().decode(errors="replace"))
print(e.read().decode(errors="replace")[-1500:])
c.close()
