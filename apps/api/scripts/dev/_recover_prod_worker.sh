#!/usr/bin/env bash
set -euo pipefail

# Prod image only ships through 080; DB was stamped ahead at 084 (newer code).
# Stamping back to the image head lets the worker entrypoint migrate cleanly.
# Extra columns from 081–084 remain and are ignored by the older image.
docker exec bokito-postgres-1 psql -U bokito -d bokito -c \
  "update alembic_version set version_num='080_agent_description';"
docker exec bokito-postgres-1 psql -U bokito -d bokito -c \
  'select * from alembic_version;'

docker restart bokito-api-1 bokito-worker-1
sleep 10
docker ps --filter name=bokito-api-1 --filter name=bokito-worker-1 \
  --format '{{.Names}} {{.Status}}'
docker logs bokito-worker-1 --tail 20 2>&1 || true
curl -s -o /dev/null -w 'prod_via_web=%{http_code}\n' http://127.0.0.1:8088/api/health || true

# Confirm Brave is visible inside prod api (field may be absent on older image).
docker exec bokito-api-1 python - <<'PY'
from app.config import get_settings
get_settings.cache_clear()
s = get_settings()
key = getattr(s, "brave_search_api_key", None)
print("has_field", key is not None)
print("prod_brave_len", len((key or "").strip()) if key is not None else -1)
PY
