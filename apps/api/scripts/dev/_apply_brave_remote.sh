#!/usr/bin/env bash
set -euo pipefail
cp /tmp/_install_brave_env.py /opt/bokito-dev/apps/api/scripts/dev/_install_brave_env.py
cp /tmp/_probe_agent_tools.py /opt/bokito-dev/apps/api/scripts/dev/_probe_agent_tools.py
cp /tmp/_verify_brave_search.py /opt/bokito-dev/apps/api/scripts/dev/_verify_brave_search.py
sed -i 's/\r$//' \
  /opt/bokito-dev/apps/api/scripts/dev/_install_brave_env.py \
  /opt/bokito-dev/apps/api/scripts/dev/_probe_agent_tools.py \
  /opt/bokito-dev/apps/api/scripts/dev/_verify_brave_search.py \
  /opt/bokito-dev/apps/api/scripts/dev/_apply_brave_remote.sh

python3 /opt/bokito-dev/apps/api/scripts/dev/_install_brave_env.py
grep -n BRAVE /opt/bokito/.env.prod /opt/bokito/.env.staging /opt/bokito-dev/apps/api/.env \
  | sed -E 's/=.+$/=***/'

systemctl restart bokito-dev-api bokito-dev-worker
sleep 2
curl -s -o /dev/null -w 'dev_health=%{http_code}\n' http://127.0.0.1:8010/api/health

cd /opt/bokito-dev/apps/api
set -a
# shellcheck disable=SC1091
. ./.env
set +a
./.venv/bin/python scripts/dev/_verify_brave_search.py

cd /opt/bokito
docker compose -p bokito --env-file .env.prod \
  -f docker-compose.prod.yml -f docker-compose.vps.yml \
  up -d --force-recreate --no-deps api worker

# Staging stack if present
if [ -f .env.staging ]; then
  docker compose -p bokito-staging --env-file .env.staging \
    -f docker-compose.prod.yml -f docker-compose.vps.yml \
    up -d --force-recreate --no-deps api worker || true
fi

sleep 6
docker ps --format '{{.Names}} {{.Status}}' | head -20
docker exec bokito-api-1 python -c '
from app.config import get_settings
from app.services.web_search import brave_search
import asyncio
get_settings.cache_clear()
s = get_settings()
print("prod_brave_len", len((s.brave_search_api_key or "").strip()))
async def main():
    out = await brave_search("straaljager", count=2, kind="images")
    print("prod_error", out.get("error"))
    print("prod_results", len(out.get("results") or []))
asyncio.run(main())
'
