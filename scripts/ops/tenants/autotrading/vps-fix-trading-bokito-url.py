#!/usr/bin/env python3
"""Fix BOKITO_BASE_URL and verify internal webhook from trading worker."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
TARGET_URL = os.environ.get("BOKITO_API_URL", "http://bokito-api:8000")

REMOTE = f"""
set -euo pipefail
perl -pi -e 's|^BOKITO_BASE_URL=.*|BOKITO_BASE_URL={TARGET_URL}|' /opt/trading/.env
grep '^BOKITO_BASE_URL=' /opt/trading/.env
cd /opt/trading && docker compose -p trading up -d worker --force-recreate
docker network connect bokito_shared trading-worker-1 2>/dev/null || true
docker network connect --alias bokito-api bokito_shared bokito-api-1 2>/dev/null || true
sleep 3
docker compose -p trading exec -T worker python <<'SMOKE'
import json, os, urllib.request, socket
print("dns", socket.gethostbyname("bokito-api"))
base = os.environ["BOKITO_BASE_URL"].rstrip("/")
print("base", base)
trigger = os.environ["BOKITO_TRIGGER_ID"]
secret = os.environ["BOKITO_WEBHOOK_SECRET"]
payload = {{"kind": "report", "subtype": "session_summary", "notes": "worker smoke", "pnl_r": 0}}
req = urllib.request.Request(
    f"{{base}}/api/hooks/{{trigger}}",
    data=json.dumps(payload).encode(),
    headers={{"Content-Type": "application/json", "X-Bokito-Secret": secret}},
    method="POST",
)
with urllib.request.urlopen(req, timeout=90) as resp:
    print("status", resp.status)
    print(resp.read().decode()[:500])
SMOKE
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=180)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
