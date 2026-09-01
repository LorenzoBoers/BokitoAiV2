#!/usr/bin/env python3
"""Check / set Moneybird OAuth client credentials on the prod VPS.

Register an app at https://moneybird.com/user/applications with redirect URI:
  {PUBLIC_API_URL}/api/integrations/oauth/callback
(e.g. https://app.bokito.ai/api/integrations/oauth/callback when API is same-origin,
 or https://api.bokito.ai/api/integrations/oauth/callback if PUBLIC_API_URL points there).

Usage (from repo root, with VPS SSH key):
  $env:MONEYBIRD_OAUTH_CLIENT_ID="..."
  $env:MONEYBIRD_OAUTH_CLIENT_SECRET="..."
  python scripts/ops/vps-set-moneybird-oauth.py --apply

Dry-run (default):
  python scripts/ops/vps-set-moneybird-oauth.py --check
"""
from __future__ import annotations

import argparse
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
ENV_FILE = "/opt/bokito/.env.prod"

KEYS = (
    "PUBLIC_API_URL",
    "PUBLIC_APP_URL",
    "MONEYBIRD_OAUTH_CLIENT_ID",
    "MONEYBIRD_OAUTH_CLIENT_SECRET",
)


def _remote_check(client: paramiko.SSHClient) -> str:
    cmd = f"""
set -e
cd /opt/bokito
for k in {' '.join(KEYS)}; do
  val=$(grep -E "^${{k}}=" {ENV_FILE} 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [ "$k" = "MONEYBIRD_OAUTH_CLIENT_SECRET" ] && [ -n "$val" ]; then
    echo "$k=***set***"
  else
    echo "$k=${{val:-(missing)}}"
  fi
done
"""
    _, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err.strip():
        print(err.strip(), file=sys.stderr)
    return out


def _remote_apply(client: paramiko.SSHClient, values: dict[str, str]) -> str:
    remote = f"""
set -euo pipefail
python3 - <<'PY'
import os
pairs = dict({repr({k: v for k, v in values.items() if v})})
path = "{ENV_FILE}"
lines = open(path).read().splitlines() if os.path.exists(path) else []
keys = set(pairs)
out = []
for line in lines:
    if "=" in line and not line.strip().startswith("#"):
        k = line.split("=", 1)[0]
        if k in keys:
            out.append(f"{{k}}={{pairs[k]}}")
            keys.remove(k)
            continue
    out.append(line)
for k in keys:
    out.append(f"{{k}}={{pairs[k]}}")
open(path, "w").write("\\n".join(out) + "\\n")
print("updated", sorted(pairs))
PY
cd /opt/bokito
docker compose --env-file .env.prod -f docker-compose.deploy.yml -f docker-compose.vps.yml up -d --pull never --no-deps --force-recreate api worker
echo "api/worker restarted"
"""
    _, stdout, stderr = client.exec_command(remote, timeout=180)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err.strip():
        print(err.strip(), file=sys.stderr)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Only print current prod values")
    parser.add_argument("--apply", action="store_true", help="Write env from local env vars and restart")
    args = parser.parse_args()

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)

    print("=== current ===")
    print(_remote_check(client).strip())

    if args.check or not args.apply:
        client.close()
        if not args.apply:
            print("\nDry-run only. Pass --apply with MONEYBIRD_OAUTH_* set locally to update.")
        return 0

    values = {
        "MONEYBIRD_OAUTH_CLIENT_ID": os.environ.get("MONEYBIRD_OAUTH_CLIENT_ID", ""),
        "MONEYBIRD_OAUTH_CLIENT_SECRET": os.environ.get("MONEYBIRD_OAUTH_CLIENT_SECRET", ""),
    }
    if not values["MONEYBIRD_OAUTH_CLIENT_ID"] or not values["MONEYBIRD_OAUTH_CLIENT_SECRET"]:
        print("Set MONEYBIRD_OAUTH_CLIENT_ID and MONEYBIRD_OAUTH_CLIENT_SECRET first.", file=sys.stderr)
        client.close()
        return 1

    print("\n=== applying ===")
    print(_remote_apply(client, values).strip())
    print("\n=== after ===")
    print(_remote_check(client).strip())
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
