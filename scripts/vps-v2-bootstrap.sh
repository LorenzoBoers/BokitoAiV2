#!/usr/bin/env bash
# One-time V2 bootstrap on the VPS: env file with generated secrets + host Caddy route.
# Run on the server as root:
#   bash scripts/vps-v2-bootstrap.sh staging   # .env.v2-staging, v2-staging.bokito.ai -> :8091
#   bash scripts/vps-v2-bootstrap.sh prod      # .env.v2,         v2.bokito.ai         -> :8090
set -euo pipefail

ENV_NAME="${1:?usage: $0 staging|prod}"
ROOT="${BOKITO_DEPLOY_ROOT:-/opt/bokito}"
cd "$ROOT"

case "$ENV_NAME" in
  staging)
    ENV_FILE=".env.v2-staging"
    HOST="v2-staging.bokito.ai"
    PORT=8091
    ENVIRONMENT="staging"
    LLM_MODE="mock"
    ;;
  prod)
    ENV_FILE=".env.v2"
    HOST="v2.bokito.ai"
    PORT=8090
    ENVIRONMENT="production"
    LLM_MODE="live"
    ;;
  *)
    echo "Unknown env: $ENV_NAME (expected staging or prod)" >&2
    exit 1
    ;;
esac

set_kv() {
  local key="$1" val="$2" file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  cp .env.v2.example "$ENV_FILE"
  DB_PASS="$(openssl rand -hex 24)"
  JWT="$(openssl rand -hex 32)"
  FERNET="$(python3 -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"
  set_kv BOKITO_V2_ENV_FILE "$ENV_FILE" "$ENV_FILE"
  set_kv BOKITO_V2_WEB_PORT "$PORT" "$ENV_FILE"
  set_kv ENVIRONMENT "$ENVIRONMENT" "$ENV_FILE"
  set_kv LLM_MODE "$LLM_MODE" "$ENV_FILE"
  set_kv PUBLIC_APP_URL "https://${HOST}" "$ENV_FILE"
  set_kv PUBLIC_API_URL "https://${HOST}" "$ENV_FILE"
  set_kv CORS_ORIGINS "https://${HOST}" "$ENV_FILE"
  set_kv POSTGRES_PASSWORD "$DB_PASS" "$ENV_FILE"
  set_kv JWT_SECRET "$JWT" "$ENV_FILE"
  set_kv CREDENTIALS_KEY "$FERNET" "$ENV_FILE"
  set_kv INBOUND_SECRET "$(openssl rand -hex 24)" "$ENV_FILE"
  set_kv WHATSAPP_VERIFY_TOKEN "$(openssl rand -hex 16)" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Created ${ENV_FILE} with generated secrets"
else
  echo "${ENV_FILE} exists; leaving it"
fi

CADDY_FILE="/etc/caddy/Caddyfile"
if ! grep -q "^${HOST} {" "$CADDY_FILE" 2>/dev/null; then
  cat >> "$CADDY_FILE" <<EOF

${HOST} {
    reverse_proxy localhost:${PORT}
}
EOF
  caddy validate --config "$CADDY_FILE"
  systemctl reload caddy
  echo "Added ${HOST} -> :${PORT} to host Caddy"
else
  echo "${HOST} already in Caddyfile"
fi

echo "V2 ${ENV_NAME} bootstrap complete. Deploy images with:"
echo "  ./scripts/vps-pull-deploy-v2.sh ${ENV_NAME} <git-sha>"
