#!/usr/bin/env python3
"""Fire a smoke webhook to the MMXM pipeline trigger on prod."""
import json
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
set -a
source /opt/trading/.env
set +a
docker compose -p trading exec -T worker python <<'PY'
import json
import os
import urllib.request

base = os.environ.get("BOKITO_BASE_URL", "").rstrip("/")
trigger = os.environ.get("BOKITO_TRIGGER_ID", "")
secret = os.environ.get("BOKITO_WEBHOOK_SECRET", "")
if not base or not trigger or not secret:
    raise SystemExit("missing BOKITO_* env")
payload = {
    "kind": "decide",
    "tenant_slug": "autotrading",
    "symbol": "NQ1!",
    "session": "smoke",
    "direction": "long",
    "setup_state_id": "smoke-setup",
    "trade_plan_id": None,
    "passed_count": 3,
    "all_passed": True,
    "ts": "smoke",
}
req = urllib.request.Request(
    f"{base}/api/hooks/{trigger}",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json", "X-Bokito-Secret": secret},
    method="POST",
)
with urllib.request.urlopen(req, timeout=120) as resp:
    print("status", resp.status)
    print(resp.read().decode()[:1000])
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=150)
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
