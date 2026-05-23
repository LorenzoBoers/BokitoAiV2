#!/usr/bin/env bash
# Repeatable deploy for Bokito runtime on Hostinger VPS.
# Usage: bash scripts/deploy-runtime-vps.sh
set -euo pipefail

ROOT="${BOKITO_RUNTIME_ROOT:-/root/bokito-runtime}"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

echo "[deploy] git pull"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git pull --ff-only
else
  echo "[deploy] skip git pull (not a git checkout)"
fi

echo "[deploy] npm install + build runtime"
npm install
npm run build -w @bokito/shared
npm run build -w @bokito/runtime

echo "[deploy] docker images"
docker build -t bokito-agent-run:latest packages/docker/agent-run
docker build -t bokito-agent-run-playwright:latest packages/docker/agent-run-playwright

echo "[deploy] pm2 reload"
cd apps/runtime
pm2 reload ecosystem.config.cjs --update-env || pm2 start ecosystem.config.cjs --update-env
pm2 save
cd "$ROOT"

echo "[deploy] reload caddy (TLS after DNS changes)"
systemctl reload caddy || true

echo "[deploy] smoke health (localhost)"
curl -sf "http://127.0.0.1:${WORKER_PORT:-3300}/health" | head -c 200
echo
echo "[deploy] done"
