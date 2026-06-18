#!/usr/bin/env bash
# Post-deploy smoke checks. Requires curl and python3 (for JSON).
#
# Usage:
#   SMOKE_EMAIL=... SMOKE_PASSWORD=... ./scripts/smoke-deploy.sh https://staging.bokito.ai
set -euo pipefail

BASE_URL="${1:?usage: $0 <base-url>}"
BASE_URL="${BASE_URL%/}"

echo "Smoke: GET ${BASE_URL}/api/health"
health=""
for attempt in 1 2 3 4 5 6; do
  if health="$(curl -sf --max-time 30 "${BASE_URL}/api/health" 2>/dev/null)"; then
    break
  fi
  if [[ "$attempt" -eq 6 ]]; then
    echo "  health failed after ${attempt} attempts" >&2
    exit 22
  fi
  echo "  health not ready (attempt ${attempt}/6), retrying in 5s..."
  sleep 5
done
python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d.get('ok') is True, d" "$health"
echo "  health ok"

if [[ -n "${SMOKE_EMAIL:-}" && -n "${SMOKE_PASSWORD:-}" ]]; then
  echo "Smoke: POST ${BASE_URL}/api/auth/login"
  login_body="$(SMOKE_EMAIL="$SMOKE_EMAIL" SMOKE_PASSWORD="$SMOKE_PASSWORD" python3 - <<'PY'
import json, os
print(json.dumps({"email": os.environ["SMOKE_EMAIL"], "password": os.environ["SMOKE_PASSWORD"]}))
PY
)"
  response="$(curl -sf --max-time 30 -X POST "${BASE_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$login_body")"
  python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d.get('access_token'), 'no token'; assert d.get('tenant',{}).get('slug'), 'no tenant'" "$response"
  echo "  login ok (tenant=$(echo "$response" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tenant',{}).get('slug','?'))"))"
else
  echo "  login skipped (set SMOKE_EMAIL + SMOKE_PASSWORD to enable)"
fi

echo "smoke_ok"
