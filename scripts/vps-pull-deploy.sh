#!/usr/bin/env bash
# Pull GHCR images and restart a Bokito stack on the VPS.
# Called by GitHub Actions over SSH and usable manually on the server.
#
# Usage:
#   ./scripts/vps-pull-deploy.sh staging <git-sha>
#   ./scripts/vps-pull-deploy.sh prod <git-sha>
set -euo pipefail

ENV_NAME="${1:?usage: $0 staging|prod <git-sha>}"
SHA="${2:?usage: $0 staging|prod <git-sha>}"
ROOT="${BOKITO_DEPLOY_ROOT:-/opt/bokito}"

cd "$ROOT"

case "$ENV_NAME" in
  staging)
    PROJECT="bokito-staging"
    ENV_FILE=".env.staging"
    WEB_TAG="${SHA}-staging"
    ;;
  prod)
    PROJECT="bokito"
    ENV_FILE=".env.prod"
    WEB_TAG="${SHA}-prod"
    ;;
  *)
    echo "Unknown env: $ENV_NAME (expected staging or prod)" >&2
    exit 1
    ;;
esac

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ROOT/$ENV_FILE" >&2
  exit 1
fi

API_IMAGE="ghcr.io/lorenzoboers/bokito-api:${SHA}"
WEB_IMAGE="ghcr.io/lorenzoboers/bokito-web:${WEB_TAG}"

if grep -q '^BOKITO_API_IMAGE=' "$ENV_FILE" 2>/dev/null; then
  grep -E '^(BOKITO_API_IMAGE|BOKITO_WEB_IMAGE)=' "$ENV_FILE" > ".rollback.${ENV_NAME}.env" || true
fi

set_kv() {
  local key="$1"
  local val="$2"
  local file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

set_kv BOKITO_API_IMAGE "$API_IMAGE" "$ENV_FILE"
set_kv BOKITO_WEB_IMAGE "$WEB_IMAGE" "$ENV_FILE"

export BOKITO_ENV_FILE="$ENV_FILE"

COMPOSE=(docker compose -p "$PROJECT" --env-file "$ENV_FILE" -f docker-compose.deploy.yml -f docker-compose.vps.yml)

"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d

echo "deploy_ok env=${ENV_NAME} sha=${SHA} api=${API_IMAGE} web=${WEB_IMAGE}"
