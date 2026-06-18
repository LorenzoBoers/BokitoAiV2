#!/usr/bin/env python3
"""Remove bokito.chargecars.app from host Caddy and migrate prod trader email."""
import os
import re
import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
set -euo pipefail
CADDY=/etc/caddy/Caddyfile
cp "$CADDY" "${CADDY}.bak-before-chargecars-removal"

python3 <<'PY'
from pathlib import Path
import re
path = Path("/etc/caddy/Caddyfile")
text = path.read_text()
# Remove entire site block for bokito.chargecars.app
text = re.sub(
    r"\nbokito\.chargecars\.app\s*\{[^}]*\}\s*",
    "\n",
    text,
    flags=re.MULTILINE | re.DOTALL,
)
path.write_text(text)
print("removed_chargecars_caddy_block")
PY

caddy validate --config "$CADDY"
systemctl reload caddy
echo caddy_reloaded

# Prod trader: chargecars email -> bokito.ai (login identity only)
docker exec bokito-postgres-1 psql -U bokito -d bokito -c \
  "UPDATE users SET email='trader@bokito.ai' WHERE email='trader@chargecars.app';"

docker exec bokito-postgres-1 psql -U bokito -d bokito -t -A -c \
  "SELECT email FROM users WHERE email LIKE 'trader@%';"
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY, timeout=120)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=180)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, end="" if err.endswith("\n") else "\n")
    code = stdout.channel.recv_exit_status()
    client.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
