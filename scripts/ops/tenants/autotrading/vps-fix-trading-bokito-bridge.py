#!/usr/bin/env python3
"""Fix trading stack Bokito bridge: .env, config.yaml, network, smoke webhook."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
BOKITO_API_URL = os.environ.get("BOKITO_API_URL", "http://bokito-api:8000")
TRIGGER_NAME = os.environ.get("BOKITO_TRIGGER_NAME", "MMXM pipeline webhook")
TRADING_ENV = os.environ.get("TRADING_ENV_FILE", "/opt/trading/.env")
TRADING_CONFIG = os.environ.get("TRADING_CONFIG", "/opt/trading/config.yaml")

REMOTE = f"""
set -euo pipefail

TRIGGER_JSON=$(cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
import json
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.trigger import Trigger

async def main():
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))
        ).scalar_one()
        trig = (
            await session.execute(
                select(Trigger).where(
                    Trigger.tenant_id == tenant.id,
                    Trigger.kind == "webhook",
                    Trigger.name == {TRIGGER_NAME!r},
                )
            )
        ).scalar_one()
        print(json.dumps({{
            "trigger_id": str(trig.id),
            "webhook_secret": trig.webhook_secret,
        }}))

asyncio.run(main())
PY
)

TRIGGER_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['trigger_id'])" "$TRIGGER_JSON")
WEBHOOK_SECRET=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['webhook_secret'])" "$TRIGGER_JSON")
echo "trigger_id=$TRIGGER_ID"

set_kv() {{
  key="$1"; val="$2"; file="{TRADING_ENV}"
  perl -pi -e "s/^${{key}}=.*/${{key}}=${{val}}/" "$file" 2>/dev/null || true
  if ! grep -q "^${{key}}=" "$file" 2>/dev/null; then
    echo "${{key}}=${{val}}" >> "$file"
  fi
}}

set_kv BOKITO_ENABLED 1
set_kv BOKITO_BASE_URL {BOKITO_API_URL}
set_kv BOKITO_TRIGGER_ID "$TRIGGER_ID"
set_kv BOKITO_WEBHOOK_SECRET "$WEBHOOK_SECRET"
grep '^BOKITO_' {TRADING_ENV}

python3 <<PY
from pathlib import Path

trigger_id = "$TRIGGER_ID"
path = Path("{TRADING_CONFIG}")
lines = path.read_text().splitlines()
out = []
in_bokito = False
replacing = False
block = [
    "bokito:",
    "  enabled: true",
    f'  base_url: "{BOKITO_API_URL}"',
    f'  trigger_id: "{{trigger_id}}"',
    '  tenant_slug: "autotrading"',
]
for line in lines:
    if line.startswith("bokito:"):
        out.extend(block)
        in_bokito = True
        replacing = True
        continue
    if in_bokito:
        if line.startswith("  "):
            continue
        in_bokito = False
    out.append(line)
if not replacing:
    out.extend(["", *block])
path.write_text("\\n".join(out) + "\\n")
print("config.yaml bokito block updated")
PY

grep -A6 '^bokito:' {TRADING_CONFIG} | head -8

cd /opt/trading
docker compose -p trading up -d worker --force-recreate
for c in trading-worker-1 trading-api-1 trading-trading-exec-mcp-1; do
  docker network connect bokito_shared "$c" 2>/dev/null || true
done
docker network connect --alias bokito-api bokito_shared bokito-api-1 2>/dev/null || true
sleep 5

echo "--- smoke webhook ---"
docker compose -p trading exec -T worker python <<SMOKE
import json
import os
import urllib.request

base = os.environ.get("BOKITO_BASE_URL", "").rstrip("/")
trigger = os.environ.get("BOKITO_TRIGGER_ID")
secret = os.environ.get("BOKITO_WEBHOOK_SECRET")
print("env trigger", trigger)
print("env base", base)
payload = {{
    "kind": "decide",
    "tenant_slug": "autotrading",
    "symbol": "NQ1!",
    "session": "smoke",
    "direction": "long",
    "setup_state_id": "smoke-setup",
    "trade_plan_id": None,
    "passed_count": 0,
    "all_passed": False,
    "ts": "smoke",
}}
req = urllib.request.Request(
    f"{{base}}/api/hooks/{{trigger}}",
    data=json.dumps(payload).encode(),
    headers={{"Content-Type": "application/json", "X-Bokito-Secret": secret}},
    method="POST",
)
with urllib.request.urlopen(req, timeout=120) as resp:
    body = resp.read().decode()
    print("webhook_status", resp.status)
    print(body[:1200])
SMOKE
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=240)
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
