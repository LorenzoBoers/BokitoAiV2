#!/usr/bin/env bash
# Pull GHCR images and restart a Bokito V2 stack on the VPS.
# Called by GitHub Actions over SSH and usable manually on the server.
#
# Usage:
#   ./scripts/vps-pull-deploy-v2.sh staging <git-sha>
#   ./scripts/vps-pull-deploy-v2.sh prod <git-sha>
set -euo pipefail

ENV_NAME="${1:?usage: $0 staging|prod <git-sha>}"
SHA="${2:?usage: $0 staging|prod <git-sha>}"
ROOT="${BOKITO_DEPLOY_ROOT:-/opt/bokito}"

cd "$ROOT"

case "$ENV_NAME" in
  staging)
    PROJECT="bokito-v2-staging"
    ENV_FILE=".env.v2-staging"
    ;;
  prod)
    PROJECT="bokito-v2"
    ENV_FILE=".env.v2"
    ;;
  *)
    echo "Unknown env: $ENV_NAME (expected staging or prod)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ROOT/$ENV_FILE (run scripts/vps-v2-bootstrap.sh $ENV_NAME first)" >&2
  exit 1
fi

API_IMAGE="ghcr.io/lorenzoboers/bokito-api-v2:${SHA}"
WEB_IMAGE="ghcr.io/lorenzoboers/bokito-web-v2:${SHA}"

if grep -q '^BOKITO_API_V2_IMAGE=' "$ENV_FILE" 2>/dev/null; then
  grep -E '^(BOKITO_API_V2_IMAGE|BOKITO_WEB_V2_IMAGE)=' "$ENV_FILE" > ".rollback.v2-${ENV_NAME}.env" || true
fi

set_kv() {
  local key="$1" val="$2" file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

set_kv BOKITO_API_V2_IMAGE "$API_IMAGE" "$ENV_FILE"
set_kv BOKITO_WEB_V2_IMAGE "$WEB_IMAGE" "$ENV_FILE"
set_kv BOKITO_V2_ENV_FILE "$ENV_FILE" "$ENV_FILE"

COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.v2.deploy.yml)

"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d --remove-orphans

echo "deploy_ok env=v2-${ENV_NAME} sha=${SHA} api=${API_IMAGE} web=${WEB_IMAGE}"
