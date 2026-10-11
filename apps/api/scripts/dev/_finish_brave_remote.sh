#!/usr/bin/env bash
set -euo pipefail

for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8010/api/health || true)
  echo "dev_health_${i}=${code}"
  if [ "$code" = "200" ]; then
    break
  fi
  sleep 1
done

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

sleep 8
docker ps --format '{{.Names}} {{.Status}}' | head -20

docker cp /opt/bokito-dev/apps/api/scripts/dev/_verify_brave_search.py bokito-api-1:/tmp/_verify_brave_search.py
docker exec -w /app bokito-api-1 python /tmp/_verify_brave_search.py
