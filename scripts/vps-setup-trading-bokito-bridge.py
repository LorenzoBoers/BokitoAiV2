#!/usr/bin/env python3
"""Wire trading lab -> Bokito webhook -> MMXM Trader (autotrading tenant).

Idempotent: reuses an existing MMXM pipeline webhook trigger when present.
Updates /opt/trading/.env (BOKITO_*) and config tenant_slug; restarts trading worker.
"""
from __future__ import annotations

import json
import os
import re
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
TENANT_SLUG = os.environ.get("TENANT_SLUG", "autotrading")
TRADER_AGENT_ID = os.environ.get("MMXM_TRADER_ID", "e1728c7f-f06d-4ea3-bbe7-1f7781ee9c25")
TRIGGER_NAME = os.environ.get("BOKITO_TRIGGER_NAME", "MMXM pipeline webhook")
BOKITO_API_URL = os.environ.get("BOKITO_API_URL", "http://bokito-api:8000")
TRADING_ENV = os.environ.get("TRADING_ENV_FILE", "/opt/trading/.env")
TRADING_CONFIG = os.environ.get("TRADING_CONFIG", "/opt/trading/config.yaml")

WEBHOOK_INSTRUCTIONS = """You are woken by the MMXM trading pipeline via webhook.

When payload kind is "decide": review the setup with MCP tools (get_setup, get_trade_plan, risk_status, get_market_context). Decide enter, skip, or escalate to the operator. Always report execution_mode and blockers.

When kind is "manage": review the open position and whether to hold, update_stop, or flatten.

Never call place_live_order unless risk_status shows execution_mode live with degiro_allow_live_orders true. In shadow mode, use check_live_order only.

Be concise and operational."""

REMOTE = f"""
set -euo pipefail

TRIGGER_JSON=$(cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
import json
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.trigger import Trigger
from app.services.triggers import create_trigger

TENANT_SLUG = {TENANT_SLUG!r}
TRADER_ID = UUID({TRADER_AGENT_ID!r})
TRIGGER_NAME = {TRIGGER_NAME!r}
INSTRUCTIONS = {WEBHOOK_INSTRUCTIONS!r}

async def main():
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == TENANT_SLUG))
        ).scalar_one_or_none()
        if not tenant:
            raise SystemExit("tenant not found")
        existing = (
            await session.execute(
                select(Trigger).where(
                    Trigger.tenant_id == tenant.id,
                    Trigger.kind == "webhook",
                    Trigger.name == TRIGGER_NAME,
                )
            )
        ).scalar_one_or_none()
        if existing:
            if existing.agent_id != TRADER_ID:
                existing.agent_id = TRADER_ID
                session.add(existing)
                await session.commit()
            print(json.dumps({{
                "trigger_id": str(existing.id),
                "webhook_secret": existing.webhook_secret,
                "created": False,
            }}))
            return
        trigger = await create_trigger(
            session,
            tenant.id,
            name=TRIGGER_NAME,
            kind="webhook",
            agent_id=TRADER_ID,
            instructions=INSTRUCTIONS,
            enabled=True,
        )
        print(json.dumps({{
            "trigger_id": str(trigger.id),
            "webhook_secret": trigger.webhook_secret,
            "created": True,
        }}))

asyncio.run(main())
PY
)

TRIGGER_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['trigger_id'])" "$TRIGGER_JSON")
WEBHOOK_SECRET=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['webhook_secret'])" "$TRIGGER_JSON")
echo "trigger_id=$TRIGGER_ID"

set_kv() {{
  key="$1"; val="$2"; file="{TRADING_ENV}"
  if grep -q "^${{key}}=" "$file" 2>/dev/null; then
    sed -i "s|^${{key}}=.*|${{key}}=${{val}}|" "$file"
  else
    echo "${{key}}=${{val}}" >> "$file"
  fi
}}

set_kv BOKITO_ENABLED 1
set_kv BOKITO_BASE_URL {BOKITO_API_URL}
set_kv BOKITO_TRIGGER_ID "$TRIGGER_ID"
set_kv BOKITO_WEBHOOK_SECRET "$WEBHOOK_SECRET"

sed -i 's/tenant_slug: "trading"/tenant_slug: "autotrading"/' {TRADING_CONFIG} || true
grep -A6 '^bokito:' {TRADING_CONFIG} | head -8

cd /opt/trading
docker compose -p trading up -d worker --force-recreate

for c in trading-worker-1 trading-api-1 trading-trading-exec-mcp-1; do
  docker network connect bokito_shared "$c" 2>/dev/null || true
done
docker network disconnect bokito_shared bokito-api-1 2>/dev/null || true
docker network connect --alias bokito-api bokito_shared bokito-api-1 2>/dev/null || true

echo "--- smoke webhook ---"
docker compose -p trading exec -T worker python <<SMOKE
import json
import os
import urllib.request

base = os.environ.get("BOKITO_BASE_URL", "{BOKITO_API_URL}").rstrip("/")
trigger = os.environ.get("BOKITO_TRIGGER_ID")
secret = os.environ.get("BOKITO_WEBHOOK_SECRET")
payload = {{
    "kind": "decide",
    "tenant_slug": "{TENANT_SLUG}",
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
with urllib.request.urlopen(req, timeout=90) as resp:
    body = resp.read().decode()
    print("webhook_status", resp.status)
    print(body[:800])
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
