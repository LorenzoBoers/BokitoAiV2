#!/usr/bin/env bash
# One-time (idempotent) VPS setup for https://dev.app.bokito.ai
# Run on the VPS as root. Does not touch /opt/bokito or the prod/staging compose projects.
set -euo pipefail
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

ROOT=/opt/bokito-dev
DBPASS_FILE=/root/.bokito-dev-db
REPO=git@github.com:LorenzoBoers/BokitoAiV2.git

if [[ ! -f "$DBPASS_FILE" ]]; then
  openssl rand -hex 24 | tr -d '\n' > "$DBPASS_FILE"
  chmod 600 "$DBPASS_FILE"
fi
DB_PASS="$(cat "$DBPASS_FILE")"

PUBKEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIKLx8OV087tsJqu3BqvCVz2x5FcXOztUJtH4OHdluFzU cursor-laptop-bokito'
AUTH=/root/.ssh/authorized_keys
touch "$AUTH"
chmod 600 "$AUTH"
grep -q 'cursor-laptop-bokito' "$AUTH" || echo "$PUBKEY" >> "$AUTH"

if ! grep -q 'dev.app.bokito.ai' /etc/caddy/Caddyfile; then
  cat >> /etc/caddy/Caddyfile << 'EOF'

# Remote Cursor dev (DNS-only). Vite on localhost.
dev.app.bokito.ai {
    reverse_proxy 127.0.0.1:5174
}
EOF
  caddy validate --config /etc/caddy/Caddyfile
  systemctl reload caddy
fi

if [[ ! -d "$ROOT/.git" ]]; then
  git clone --branch master "$REPO" "$ROOT"
fi
mkdir -p /root/bokito-dev-assets
if [[ -f /root/bokito-dev-assets/docker-compose.dev-remote.yml ]]; then
  cp /root/bokito-dev-assets/docker-compose.dev-remote.yml "$ROOT/docker-compose.dev-remote.yml"
fi
if [[ -f /root/bokito-dev-assets/vite.config.ts ]]; then
  cp /root/bokito-dev-assets/vite.config.ts "$ROOT/apps/dashboard/vite.config.ts"
fi

install -m 600 /dev/null "$ROOT/.env.dev-remote"
printf 'BOKITO_DEV_DB_PASSWORD=%s\n' "$DB_PASS" > "$ROOT/.env.dev-remote"
if [[ ! -f "$ROOT/docker-compose.dev-remote.yml" ]]; then
  echo "missing $ROOT/docker-compose.dev-remote.yml" >&2
  exit 1
fi
docker compose -p bokito-dev --env-file "$ROOT/.env.dev-remote" \
  -f "$ROOT/docker-compose.dev-remote.yml" up -d

JWT="$(openssl rand -hex 32)"
umask 077
cat > "$ROOT/apps/api/.env" << EOF
DATABASE_URL=postgresql+asyncpg://bokito:${DB_PASS}@127.0.0.1:5433/bokito
REDIS_URL=redis://127.0.0.1:6380/0
LLM_MODE=mock
ENVIRONMENT=dev
JWT_SECRET=${JWT}
WORKER_INBOUND_SECRET=$(openssl rand -hex 24)
CORS_ORIGINS=https://dev.app.bokito.ai
PUBLIC_API_URL=https://dev.app.bokito.ai
PUBLIC_APP_URL=https://dev.app.bokito.ai
EOF
chmod 600 "$ROOT/apps/api/.env"

cat > "$ROOT/apps/dashboard/.env.development.local" << 'EOF'
VITE_DEV_PUBLIC_HOST=dev.app.bokito.ai
VITE_BOKITO_API_URL=http://127.0.0.1:8010
VITE_APP_CONTROL_PLANE_HOST=dev.app.bokito.ai
VITE_APP_CONTROL_PLANE_URL=https://dev.app.bokito.ai
VITE_TENANT_ROOT_DOMAIN=.bokito.ai
VITE_PUBLIC_API_URL=https://dev.app.bokito.ai
VITE_PLATFORM_DEFAULT_LANGUAGE=nl
EOF

if [[ ! -x "$ROOT/apps/api/.venv/bin/python" ]]; then
  python3 -m venv "$ROOT/apps/api/.venv"
  "$ROOT/apps/api/.venv/bin/pip" install -U pip uv
  "$ROOT/apps/api/.venv/bin/uv" pip install --python "$ROOT/apps/api/.venv/bin/python" -e "$ROOT/apps/api"
fi

# 003_baseline creates the current models. Later revisions replay the historical
# shape and fail on an empty database, so a fresh dev DB is stamped at head.
(
  cd "$ROOT/apps/api"
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  if ! "$ROOT/apps/api/.venv/bin/alembic" current 2>/dev/null | grep -q '(head)'; then
    "$ROOT/apps/api/.venv/bin/alembic" upgrade 003_baseline
    "$ROOT/apps/api/.venv/bin/alembic" stamp head
  fi
)

if [[ ! -d "$ROOT/node_modules/vite" && ! -d "$ROOT/apps/dashboard/node_modules/vite" ]]; then
  (cd "$ROOT" && npm install -w bokito-dashboard)
fi

cat > /etc/systemd/system/bokito-dev-api.service << EOF
[Unit]
Description=Bokito remote dev API
After=network-online.target docker.service
Wants=network-online.target

[Service]
WorkingDirectory=$ROOT/apps/api
EnvironmentFile=$ROOT/apps/api/.env
ExecStart=$ROOT/apps/api/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 --reload
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/bokito-dev-worker.service << EOF
[Unit]
Description=Bokito remote dev worker
After=bokito-dev-api.service
Wants=bokito-dev-api.service

[Service]
WorkingDirectory=$ROOT/apps/api
EnvironmentFile=$ROOT/apps/api/.env
ExecStart=$ROOT/apps/api/.venv/bin/arq app.workers.tasks.WorkerSettings
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

NPM="$(command -v npm)"
cat > /etc/systemd/system/bokito-dev-dashboard.service << EOF
[Unit]
Description=Bokito remote dev dashboard
After=bokito-dev-api.service

[Service]
WorkingDirectory=$ROOT/apps/dashboard
Environment=VITE_DEV_PUBLIC_HOST=dev.app.bokito.ai
Environment=VITE_BOKITO_API_URL=http://127.0.0.1:8010
Environment=VITE_APP_CONTROL_PLANE_HOST=dev.app.bokito.ai
Environment=VITE_APP_CONTROL_PLANE_URL=https://dev.app.bokito.ai
Environment=VITE_TENANT_ROOT_DOMAIN=.bokito.ai
Environment=VITE_PUBLIC_API_URL=https://dev.app.bokito.ai
ExecStart=${NPM} run dev -- --host 127.0.0.1 --port 5174 --strictPort
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now bokito-dev-api.service bokito-dev-dashboard.service bokito-dev-worker.service

ready=0
for _ in $(seq 1 90); do
  if curl -sf http://127.0.0.1:8010/api/health >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != 1 ]]; then
  journalctl -u bokito-dev-api.service -n 40 --no-pager >&2
  exit 1
fi
(
  cd "$ROOT/apps/api"
  "$ROOT/apps/api/.venv/bin/python" scripts/seed.py
)

echo "SETUP_OK"
