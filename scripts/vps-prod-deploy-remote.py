#!/usr/bin/env python3
"""One-off: GHCR login on VPS + production deploy."""
import os
import subprocess
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
SHA = sys.argv[1] if len(sys.argv) > 1 else "776f3552ec43addc80fae3e861c263e058bfec79"

token = subprocess.check_output(["gh", "auth", "token"], text=True).strip()
cmd = f"""set -euo pipefail
echo '{token}' | docker login ghcr.io -u LorenzoBoers --password-stdin
cd /opt/bokito
./scripts/vps-pull-deploy.sh prod {SHA}
"""

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username="root", key_filename=KEY, timeout=120)
_, stdout, stderr = client.exec_command(cmd, timeout=600)
out = stdout.read().decode()
err = stderr.read().decode()
if out:
    print(out, end="" if out.endswith("\n") else "\n")
if err:
    print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
code = stdout.channel.recv_exit_status()
client.close()
raise SystemExit(code)
