#!/usr/bin/env python3
"""Ensure trading stack containers stay on bokito_shared (required for MCP + Bokito webhook)."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

CONTAINERS = (
    "trading-worker-1",
    "trading-api-1",
    "trading-trading-exec-mcp-1",
    "bokito-api-1",
    "bokito-worker-1",
)

REMOTE = f"""
set -euo pipefail
for c in {' '.join(CONTAINERS)}; do
  if docker inspect "$c" >/dev/null 2>&1; then
    docker network connect bokito_shared "$c" 2>/dev/null || true
  fi
done
if docker inspect bokito-api-1 >/dev/null 2>&1; then
  docker network disconnect bokito_shared bokito-api-1 2>/dev/null || true
  docker network connect --alias bokito-api bokito_shared bokito-api-1 2>/dev/null || \
    docker network connect bokito_shared bokito-api-1 2>/dev/null || true
fi
if docker inspect trading-trading-exec-mcp-1 >/dev/null 2>&1; then
  docker network disconnect bokito_shared trading-trading-exec-mcp-1 2>/dev/null || true
  docker network connect --alias trading-exec-mcp bokito_shared trading-trading-exec-mcp-1 2>/dev/null || \
    docker network connect bokito_shared trading-trading-exec-mcp-1 2>/dev/null || true
fi
docker compose -p bokito exec -T api getent hosts trading-exec-mcp 2>/dev/null || true
docker compose -p trading exec -T worker getent hosts bokito-api 2>/dev/null || true
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=60)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
