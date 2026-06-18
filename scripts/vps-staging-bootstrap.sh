#!/usr/bin/env bash
# One-time staging bootstrap on the VPS: env file, host Caddy route, optional seed.
# Run on the server as root (or via: python scripts/vps-exec.py "bash -s" < scripts/vps-staging-bootstrap.sh)
set -euo pipefail

ROOT="${BOKITO_DEPLOY_ROOT:-/opt/bokito}"
cd "$ROOT"

if [[ ! -f .env.staging ]]; then
  cp .env.staging.example .env.staging
  DB_PASS="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 32)"
  sed -i "s|CHANGE_ME_staging_db_password|${DB_PASS}|g" .env.staging
  sed -i "s|CHANGE_ME_staging_jwt_secret|${JWT_SECRET}|g" .env.staging
  echo "Created .env.staging with generated secrets"
fi

CADDY_FILE="/etc/caddy/Caddyfile"
if ! grep -q 'staging.bokito.ai' "$CADDY_FILE" 2>/dev/null; then
  cat >> "$CADDY_FILE" <<'EOF'

staging.bokito.ai {
    reverse_proxy localhost:8089
}
EOF
  caddy validate --config "$CADDY_FILE"
  systemctl reload caddy
  echo "Added staging.bokito.ai -> :8089 to host Caddy"
else
  echo "staging.bokito.ai already in Caddyfile"
fi

echo "Staging bootstrap complete. Deploy images with:"
echo "  ./scripts/vps-pull-deploy.sh staging <git-sha>"
