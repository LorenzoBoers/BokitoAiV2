#!/usr/bin/env python3
"""Set TRADING_MCP_* on prod .env.prod and restart api/worker."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
MCP_URL = os.environ.get("TRADING_MCP_URL", "http://trading-exec-mcp:8002/mcp")
MCP_KEY = os.environ.get("TRADING_MCP_API_KEY", "local-dev-key")

REMOTE = f"""
set -euo pipefail
cd /opt/bokito
ENV_FILE=.env.prod
touch "$ENV_FILE"
set_kv() {{
  local key="$1" val="$2"
  if grep -q "^${{key}}=" "$ENV_FILE"; then
    sed -i "s|^${{key}}=.*|${{key}}=${{val}}|" "$ENV_FILE"
  else
    echo "${{key}}=${{val}}" >> "$ENV_FILE"
  fi
}}
set_kv TRADING_MCP_URL "{MCP_URL}"
set_kv TRADING_MCP_API_KEY "{MCP_KEY}"
grep '^TRADING_MCP_' "$ENV_FILE"
docker compose -p bokito --env-file "$ENV_FILE" -f docker-compose.deploy.yml -f docker-compose.vps.yml up -d api worker
docker network inspect bokito_shared >/dev/null 2>&1 || docker network create bokito_shared
docker network connect bokito_shared bokito-api-1 2>/dev/null || true
docker network connect bokito_shared bokito-worker-1 2>/dev/null || true
sleep 5
docker compose -p bokito exec -T api printenv TRADING_MCP_URL
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
