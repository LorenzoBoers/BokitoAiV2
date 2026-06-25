#!/usr/bin/env python3
"""Rollback DeGiro to shadow mode (dry-run, no real orders)."""
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
  sed -i "s|^${key}=.*|${key}=${val}|" "$file"
}
set_kv EXECUTION_MODE shadow
set_kv DEGIRO_ALLOW_LIVE_ORDERS 0
sed -i 's/^  mode: live/  mode: shadow/' __TRADING_CONFIG__ || true
grep -E '^EXECUTION_MODE=|^DEGIRO_ALLOW_LIVE' __TRADING_ENV__
cd /opt/trading && docker compose -p trading up -d worker trading-exec-mcp --force-recreate
python3 /opt/bokito/scripts/ops/tenants/autotrading/vps-ensure-trading-network.py 2>/dev/null || true
""".replace("__TRADING_ENV__", TRADING_ENV).replace("__TRADING_CONFIG__", TRADING_CONFIG)


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
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
