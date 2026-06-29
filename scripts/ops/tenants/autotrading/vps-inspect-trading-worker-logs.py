#!/usr/bin/env python3
"""Broader trading worker log tail for setup detection and Bokito webhook activity."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = """
echo '=== config.yaml bokito + execution ==='
grep -A8 '^bokito:' /opt/trading/config.yaml | head -10
grep -E 'mode:|execution|session' /opt/trading/config.yaml | head -15

echo '=== worker logs tail 200 ==='
docker compose -p trading logs worker --tail 200 2>&1

echo '=== trading-api logs (setup/decide) ==='
docker compose -p trading logs api --tail 80 2>&1 | grep -iE 'setup|decide|bokito|webhook|mmxm|scan' | tail -30 || true
"""


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
