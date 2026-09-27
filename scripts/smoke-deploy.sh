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
  # Password login may mint a session, stop at TOTP, or ask for workspace setup.
  # Any of these proves auth + DB are up (smoke accounts may lack a tenant).
  python3 -c "
import json,sys
d=json.loads(sys.argv[1])
if d.get('access_token'):
    assert d.get('tenant',{}).get('slug'), 'no tenant'
elif d.get('requires_2fa') and d.get('challenge_token'):
    pass
elif d.get('requires_workspace') and d.get('setup_token'):
    pass
else:
    raise SystemExit('unexpected login response: ' + json.dumps(d)[:300])
" "$response"
  echo "  login ok ($(echo "$response" | python3 -c "import json,sys; d=json.load(sys.stdin); print('workspace-setup' if d.get('requires_workspace') else ('2fa' if d.get('requires_2fa') else 'tenant='+str(d.get('tenant',{}).get('slug','?'))))"))"
else
  echo "  login skipped (set SMOKE_EMAIL + SMOKE_PASSWORD to enable)"
fi

echo "smoke_ok"
