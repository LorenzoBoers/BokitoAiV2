#!/usr/bin/env bash
# Post-deploy smoke for a Bokito V2 host. Requires curl and python3.
#
# Usage:
#   ./scripts/smoke-v2.sh https://v2-staging.bokito.ai
#   SMOKE_EMAIL=... SMOKE_PASSWORD=... ./scripts/smoke-v2.sh https://v2.bokito.ai
set -euo pipefail

BASE_URL="${1:?usage: $0 <base-url>}"
BASE_URL="${BASE_URL%/}"

echo "Smoke: GET ${BASE_URL}/api/health/ready"
ready=""
for attempt in 1 2 3 4 5 6 7 8; do
  if ready="$(curl -sf --max-time 30 "${BASE_URL}/api/health/ready" 2>/dev/null)"; then
    break
  fi
  if [[ "$attempt" -eq 8 ]]; then
    echo "  readiness failed after ${attempt} attempts" >&2
    exit 22
  fi
  echo "  not ready (attempt ${attempt}/8), retrying in 10s..."
  sleep 10
done
python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d.get('ok') is True, d" "$ready"
echo "  ready ok"

echo "Smoke: OAuth discovery"
meta="$(curl -sf --max-time 30 "${BASE_URL}/.well-known/oauth-authorization-server/api/oauth")"
python3 -c "
import json,sys
d=json.loads(sys.argv[1])
assert d['issuer'].startswith(sys.argv[2]), d['issuer']
assert 'S256' in d['code_challenge_methods_supported'], d
" "$meta" "$BASE_URL"
echo "  issuer $(echo "$meta" | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])')"

echo "Smoke: MCP challenge"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST "${BASE_URL}/api/mcp" \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
if [[ "$code" != "401" ]]; then
  echo "  expected 401 from unauthenticated MCP call, got ${code}" >&2
  exit 23
fi
echo "  401 ok"

echo "Smoke: web shell"
html="$(curl -sf --max-time 30 "${BASE_URL}/")"
grep -q '<div id="root"' <<<"$html" || { echo "  web shell missing #root" >&2; exit 24; }
echo "  web ok"

if [[ -n "${SMOKE_EMAIL:-}" && -n "${SMOKE_PASSWORD:-}" ]]; then
  echo "Smoke: POST ${BASE_URL}/api/auth/login"
  body="$(SMOKE_EMAIL="$SMOKE_EMAIL" SMOKE_PASSWORD="$SMOKE_PASSWORD" python3 -c 'import json,os; print(json.dumps({"email": os.environ["SMOKE_EMAIL"], "password": os.environ["SMOKE_PASSWORD"]}))')"
  resp="$(curl -sf --max-time 30 -X POST "${BASE_URL}/api/auth/login" -H 'Content-Type: application/json' -d "$body")"
  python3 -c "import json,sys; d=json.loads(sys.argv[1]); assert d.get('access_token'), d" "$resp"
  echo "  login ok"
else
  echo "  login skipped (set SMOKE_EMAIL + SMOKE_PASSWORD to enable)"
fi

echo "smoke_ok"
