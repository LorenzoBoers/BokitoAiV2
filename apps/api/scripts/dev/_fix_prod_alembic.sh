#!/usr/bin/env bash
set -euo pipefail

echo '=== prod image alembic heads (in container) ==='
docker exec bokito-api-1 ls /app/alembic/versions 2>/dev/null | tail -20 || true

echo '=== alembic_version in prod DB ==='
# shellcheck disable=SC1091
set -a && . /opt/bokito/.env.prod && set +a
# Prefer docker exec into postgres
docker exec bokito-postgres-1 psql -U "${POSTGRES_USER:-bokito}" -d "${POSTGRES_DB:-bokito}" -c 'select * from alembic_version;'

echo '=== worker logs (last 15) ==='
docker logs bokito-worker-1 --tail 15 2>&1 || true

echo '=== api health ==='
docker inspect --format '{{.State.Health.Status}}' bokito-api-1 2>/dev/null || true
curl -s -o /dev/null -w 'prod_via_web=%{http_code}\n' http://127.0.0.1:8088/api/health || true
