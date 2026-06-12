#!/usr/bin/env bash
# Bokito MVP single-VPS deploy helper (run ON the VPS, from the repo root).
#
# Prereqs on the VPS:
#   - Docker Engine + compose plugin installed
#   - This repo cloned/copied here
#   - .env.prod created from .env.prod.example with real secrets:
#       BOKITO_DOMAIN, JWT_SECRET, POSTGRES_PASSWORD, DATABASE_URL,
#       ENVIRONMENT=prod, LLM_MODE=live, ANTHROPIC_API_KEY, OPENAI_API_KEY, CORS_ORIGINS
#   - DNS A record for BOKITO_DOMAIN already points at this VPS public IP
#
# Usage:
#   ./deploy.sh            # build + start the full stack, then seed
#   ./deploy.sh --no-seed  # build + start only (skip the one-off seed)

set -euo pipefail

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.prod"
RUN_SEED=1

for arg in "$@"; do
  case "$arg" in
    --no-seed) RUN_SEED=0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.prod.example to .env.prod and fill it in." >&2
  exit 1
fi

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

echo "==> Building and starting the stack"
compose up -d --build

echo "==> Waiting for the API to become healthy"
for i in $(seq 1 60); do
  status="$(compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$1=="api"{print $2}')"
  if [[ "$status" == "healthy" ]]; then
    echo "    api is healthy"
    break
  fi
  sleep 5
  if [[ "$i" == "60" ]]; then
    echo "ERROR: api did not become healthy in time. Recent logs:" >&2
    compose logs --tail=50 api >&2
    exit 1
  fi
done

if [[ "$RUN_SEED" == "1" ]]; then
  echo "==> Seeding the database (idempotent: creates tenant + admin@bokito.ai)"
  compose exec -T api python scripts/seed.py
  echo "    NOTE: rotate the seeded admin password after first login."
fi

echo "==> Readiness check"
compose exec -T api python -c "import urllib.request,json; print(urllib.request.urlopen('http://127.0.0.1:8000/api/health/ready').read().decode())"

echo "==> Done. Public URL: https://$(grep -E '^BOKITO_DOMAIN=' "$ENV_FILE" | cut -d= -f2-)"
