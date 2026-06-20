#!/usr/bin/env python3
"""Enable DeGiro live execution on the VPS trading stack (gated by risk caps)."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
TRADING_ENV = os.environ.get("TRADING_ENV_FILE", "/opt/trading/.env")
TRADING_CONFIG = os.environ.get("TRADING_CONFIG", "/opt/trading/config.yaml")

REMOTE = r"""
set -euo pipefail

set_kv() {
  key="$1"; val="$2"; file="__TRADING_ENV__"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

set_kv EXECUTION_MODE live
set_kv DEGIRO_ALLOW_LIVE_ORDERS 1
sed -i 's/^  mode: virtual/  mode: live/' __TRADING_CONFIG__ || true
sed -i 's/^  mode: shadow/  mode: live/' __TRADING_CONFIG__ || true
grep -E '^EXECUTION_MODE=|^DEGIRO_ALLOW_LIVE' __TRADING_ENV__
grep 'mode:' __TRADING_CONFIG__ | head -1

cd /opt/trading
docker compose -p trading up -d worker trading-exec-mcp --force-recreate

for c in trading-worker-1 trading-api-1 trading-trading-exec-mcp-1; do
  docker network connect bokito_shared "$c" 2>/dev/null || true
done
docker network disconnect bokito_shared bokito-api-1 2>/dev/null || true
docker network connect --alias bokito-api bokito_shared bokito-api-1 2>/dev/null || true

sleep 8

cd /opt/bokito
docker network connect bokito_shared bokito-api-1 2>/dev/null || true
docker network disconnect bokito_shared bokito-api-1 2>/dev/null || true
docker network connect --alias bokito-api bokito_shared bokito-api-1 2>/dev/null || true
for c in trading-worker-1 trading-api-1 trading-trading-exec-mcp-1 bokito-api-1 bokito-worker-1; do
  docker network connect bokito_shared "$c" 2>/dev/null || true
done

cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import json
import os
import urllib.request

URL = os.environ.get("TRADING_MCP_URL", "http://trading-exec-mcp:8002/mcp")
KEY = os.environ.get("TRADING_MCP_API_KEY", "local-dev-key")

def mcp_tool(name, arguments=None):
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments or dict()},
    }
    req = urllib.request.Request(
        URL,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    content = (data.get("result") or {}).get("content") or []
    if content and isinstance(content[0].get("text"), str):
        return json.loads(content[0]["text"])
    return data

for tool in ("risk_status", "kill_switch_status", "get_positions"):
    try:
        out = mcp_tool(tool)
        print(tool + ":", json.dumps(out)[:600])
    except Exception as exc:
        print(tool + " error:", exc)
PY
""".replace("__TRADING_ENV__", TRADING_ENV).replace("__TRADING_CONFIG__", TRADING_CONFIG)


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
