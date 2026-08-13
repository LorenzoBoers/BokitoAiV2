#!/usr/bin/env python3
"""Check / set Microsoft OAuth + public URL env on prod VPS for email MVP.

Reads MICROSOFT_OAUTH_* from the local environment (or prompts via env file)
and merges them into /opt/bokito/.env.prod, then recreates api + worker.

Usage (from repo root, with VPS SSH key):
  $env:MICROSOFT_OAUTH_CLIENT_ID="..."
  $env:MICROSOFT_OAUTH_CLIENT_SECRET="..."
  python scripts/ops/vps-set-microsoft-oauth.py

Or dry-run (default) to only print current values:
  python scripts/ops/vps-set-microsoft-oauth.py --check
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
    "MICROSOFT_OAUTH_CLIENT_ID",
    "MICROSOFT_OAUTH_CLIENT_SECRET",
    "MICROSOFT_OAUTH_TENANT",
    "EMAIL_SYNC_ENABLED",
)


def _remote_check(client: paramiko.SSHClient) -> str:
    cmd = f"""
set -e
cd /opt/bokito
for k in {' '.join(KEYS)}; do
  val=$(grep -E "^${{k}}=" {ENV_FILE} 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [ "$k" = "MICROSOFT_OAUTH_CLIENT_SECRET" ] && [ -n "$val" ]; then
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
    pairs = " ".join(f"{k}={v!r}" for k, v in values.items() if v)
    remote = f"""
set -euo pipefail
ENV_FILE={ENV_FILE}
set_kv() {{
  key="$1"; val="$2"
  if grep -q "^${{key}}=" "$ENV_FILE" 2>/dev/null; then
    perl -pi -e "s|^${{key}}=.*|${{key}}=${{val}}|" "$ENV_FILE"
  else
    echo "${{key}}=${{val}}" >> "$ENV_FILE"
  fi
}}
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
docker compose --env-file .env.prod -f docker-compose.deploy.yml -f docker-compose.vps.yml up -d api worker
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
            print("\nDry-run only. Pass --apply with MICROSOFT_OAUTH_* set locally to update.")
        return 0

    values = {
        "PUBLIC_API_URL": os.environ.get("PUBLIC_API_URL", "https://app.bokito.ai"),
        "PUBLIC_APP_URL": os.environ.get("PUBLIC_APP_URL", "https://app.bokito.ai"),
        "MICROSOFT_OAUTH_CLIENT_ID": os.environ.get("MICROSOFT_OAUTH_CLIENT_ID", ""),
        "MICROSOFT_OAUTH_CLIENT_SECRET": os.environ.get("MICROSOFT_OAUTH_CLIENT_SECRET", ""),
        "MICROSOFT_OAUTH_TENANT": os.environ.get("MICROSOFT_OAUTH_TENANT", "common"),
        "EMAIL_SYNC_ENABLED": os.environ.get("EMAIL_SYNC_ENABLED", "true"),
    }
    if not values["MICROSOFT_OAUTH_CLIENT_ID"] or not values["MICROSOFT_OAUTH_CLIENT_SECRET"]:
        print("Set MICROSOFT_OAUTH_CLIENT_ID and MICROSOFT_OAUTH_CLIENT_SECRET first.", file=sys.stderr)
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
