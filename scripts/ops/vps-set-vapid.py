#!/usr/bin/env python3
"""Generate / apply Web Push VAPID keys on the prod VPS.

Merges VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CLAIMS_EMAIL into
/opt/bokito/.env.prod and recreates api + worker.

Usage (from repo root, with VPS SSH key):
  python scripts/ops/vps-set-vapid.py --check
  python scripts/ops/vps-set-vapid.py --apply
  python scripts/ops/vps-set-vapid.py --apply --force   # rotate even if set

Optional overrides via env:
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CLAIMS_EMAIL
"""
from __future__ import annotations

import argparse
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
ENV_FILE = "/opt/bokito/.env.prod"

KEYS = ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_CLAIMS_EMAIL")


def _generate_vapid_pair() -> tuple[str, str]:
    try:
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        from py_vapid import Vapid
        from py_vapid.utils import b64urlencode
    except ImportError as exc:  # pragma: no cover
        raise SystemExit(
            "py_vapid/cryptography required. Run with apps/api/.venv active, "
            "or set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY in the environment."
        ) from exc

    vapid = Vapid()
    vapid.generate_keys()
    public = b64urlencode(
        vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    )
    private = b64urlencode(
        vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    )
    return public, private


def _remote_check(client: paramiko.SSHClient) -> str:
    cmd = f"""
set -e
for k in {' '.join(KEYS)}; do
  val=$(grep -E "^${{k}}=" {ENV_FILE} 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [ -z "$val" ]; then
    echo "$k=(empty)"
  elif [ "$k" = "VAPID_PRIVATE_KEY" ]; then
    echo "$k=***set*** (len=${{#val}})"
  else
    echo "$k=$val"
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
pairs = dict({repr(values)})
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
# Avoid GHCR pull (auth often missing on VPS); recreate with existing images + new env.
docker compose --env-file .env.prod -f docker-compose.deploy.yml -f docker-compose.vps.yml up -d --pull never --force-recreate api worker
echo "api/worker restarted"
"""
    _, stdout, stderr = client.exec_command(remote, timeout=180)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if err.strip():
        print(err.strip(), file=sys.stderr)
    return out


def _verify_endpoint(client: paramiko.SSHClient) -> str:
    """Prefer in-VPS checks: Cloudflare may block non-browser clients (1010)."""
    remote = r"""
set -euo pipefail
cd /opt/bokito
API_ID=$(docker compose --env-file .env.prod -f docker-compose.deploy.yml -f docker-compose.vps.yml ps -q api)
docker exec "$API_ID" python -c "import urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8000/api/push/vapid-public-key', timeout=10); print(r.status, r.read().decode()[:200])"
curl -sS -o /tmp/vapid_pub.json -w "public_host HTTP %{http_code}\n" https://api.bokito.ai/api/push/vapid-public-key
head -c 200 /tmp/vapid_pub.json; echo
"""
    _, stdout, stderr = client.exec_command(remote, timeout=90)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if err:
        return f"{out}\nstderr: {err}" if out else f"stderr: {err}"
    return out or "verify returned empty"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Only print current prod values")
    parser.add_argument("--apply", action="store_true", help="Write VAPID env and restart")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Rotate keys even when public+private are already set",
    )
    args = parser.parse_args()

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)

    print("=== current ===")
    current = _remote_check(client)
    print(current.strip())

    if args.check or not args.apply:
        client.close()
        if not args.apply:
            print("\nDry-run only. Pass --apply to generate/set keys and restart.")
        return 0

    public = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
    private = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    claims = os.environ.get("VAPID_CLAIMS_EMAIL", "").strip() or "mailto:ops@bokito.ai"

    already = (
        "VAPID_PUBLIC_KEY=(empty)" not in current
        and "VAPID_PRIVATE_KEY=(empty)" not in current
        and "***set***" in current
    )
    if already and not args.force and not (public and private):
        print("\nVAPID keys already set. Pass --force to rotate, or set both env overrides.")
        client.close()
        return 0

    if not public or not private:
        public, private = _generate_vapid_pair()
        print("\nGenerated new VAPID key pair (private key not printed).")

    values = {
        "VAPID_PUBLIC_KEY": public,
        "VAPID_PRIVATE_KEY": private,
        "VAPID_CLAIMS_EMAIL": claims,
    }

    print("\n=== applying ===")
    print(_remote_apply(client, values).strip())
    print("\n=== after ===")
    print(_remote_check(client).strip())
    print("\n=== verify ===")
    print(_verify_endpoint(client))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
