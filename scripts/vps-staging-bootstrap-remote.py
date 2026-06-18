#!/usr/bin/env python3
"""One-off: bootstrap staging on VPS (env + Caddy)."""
import os
import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
set -euo pipefail
cd /opt/bokito
if [ ! -f .env.staging ]; then
  DB_PASS=$(openssl rand -hex 24)
  JWT_SECRET=$(openssl rand -hex 32)
  cat > .env.staging <<EOF
BOKITO_ENV_FILE=.env.staging
BOKITO_API_IMAGE=ghcr.io/lorenzoboers/bokito-api:master
BOKITO_WEB_IMAGE=ghcr.io/lorenzoboers/bokito-web:master-staging
BOKITO_DOMAIN=:80
BOKITO_WEB_PORT=8089
VITE_APP_VERSION=staging
VITE_APP_CONTROL_PLANE_HOST=staging.bokito.ai
VITE_TENANT_ROOT_DOMAIN=.bokito.ai
ENVIRONMENT=staging
POSTGRES_USER=bokito
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=bokito_staging
DATABASE_URL=postgresql+asyncpg://bokito:${DB_PASS}@postgres:5432/bokito_staging
REDIS_URL=redis://redis:6379/0
JWT_SECRET=${JWT_SECRET}
CORS_ORIGINS=https://staging.bokito.ai
LLM_MODE=mock
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
EOF
  echo created_env_staging
else
  echo env_staging_exists
fi
CADDY=/etc/caddy/Caddyfile
if ! grep -q 'staging.bokito.ai' "$CADDY"; then
  printf '\nstaging.bokito.ai {\n    reverse_proxy localhost:8089\n}\n' >> "$CADDY"
  caddy validate --config "$CADDY"
  systemctl reload caddy
  echo added_caddy_staging
else
  echo caddy_staging_exists
fi
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
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
