#!/usr/bin/env bash
set -euo pipefail
# Smoke test for platform-api — auto-detects auth mode.
#
# Dev JWT mode (AUTH_MODE=dev_jwt or CLERK_AUTH_ENABLED unset/false):
#   Tests /ready, login, call lifecycle, /calls, /analytics/outcomes.
#   Prerequisites: platform-api running, Postgres seeded (test-tenant).
#
# Clerk mode (AUTH_MODE=clerk or CLERK_AUTH_ENABLED=true):
#   Delegates to scripts/smoke-clerk.sh for Clerk-aware tests.
#   Set CLERK_BEARER env var for authenticated endpoint tests.
#
#   export API_BASE=http://localhost:3001   # optional override

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

API_BASE="${API_BASE:-http://localhost:3001}"
LOGIN_EMAIL="${LOGIN_EMAIL:-admin@example.com}"
TENANT_ID="${TENANT_ID:-test-tenant}"
PHONE="${PHONE:-+18737101393}"
CALL_ID="smoke-$(date +%s)-$RANDOM"

# ── Detect auth mode ───────────────────────────────────────────────────────────
AUTH_MODE_EFFECTIVE="dev_jwt"
ENV_FILE="$ROOT/apps/platform-api/.env"
if [[ -f "$ENV_FILE" ]]; then
  _mode=$(grep -E '^[[:space:]]*AUTH_MODE=' "$ENV_FILE" | head -1 | sed 's/^[[:space:]]*AUTH_MODE=//' | tr -d '"' | tr -d "'" | tr -d '[:space:]')
  _clerk=$(grep -E '^[[:space:]]*CLERK_AUTH_ENABLED=' "$ENV_FILE" | head -1 | sed 's/^[[:space:]]*CLERK_AUTH_ENABLED=//' | tr -d '"' | tr -d "'" | tr -d '[:space:]')
  if [[ "$_mode" == "clerk" ]] || [[ "$_clerk" == "true" ]]; then
    AUTH_MODE_EFFECTIVE="clerk"
  fi
fi

if [[ "$AUTH_MODE_EFFECTIVE" == "clerk" ]]; then
  echo "==> Detected AUTH_MODE=clerk — delegating to scripts/smoke-clerk.sh"
  exec bash "$ROOT/scripts/smoke-clerk.sh" "$@"
fi

echo "==> Auth mode: dev_jwt"
echo ""

echo "==> GET $API_BASE/ready"
curl -sfS "$API_BASE/ready" | head -c 200
echo ""

echo "==> POST $API_BASE/auth/login"
LOGIN_JSON=$(curl -sfS -X POST "$API_BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$LOGIN_EMAIL\"}")
TOKEN=$(echo "$LOGIN_JSON" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!j.token) process.exit(1); process.stdout.write(j.token);")

echo "==> POST /calls/start"
curl -sfS -X POST "$API_BASE/calls/start" \
  -H 'Content-Type: application/json' \
  -d "{
    \"callId\": \"$CALL_ID\",
    \"tenantId\": \"$TENANT_ID\",
    \"phoneNumber\": \"$PHONE\",
    \"callerNumber\": \"+15551234567\",
    \"direction\": \"inbound\"
  }" | head -c 200
echo ""

echo "==> POST /calls/end"
curl -sfS -X POST "$API_BASE/calls/end" \
  -H 'Content-Type: application/json' \
  -d "{
    \"callId\": \"$CALL_ID\",
    \"tenantId\": \"$TENANT_ID\",
    \"outcome\": \"handled\",
    \"durationSec\": 42,
    \"endReason\": \"completed\"
  }" | head -c 200
echo ""

echo "==> GET /calls (Bearer)"
curl -sfS "$API_BASE/calls" \
  -H "Authorization: Bearer $TOKEN" | head -c 400
echo ""

echo "==> GET /analytics/outcomes (Bearer)"
curl -sfS "$API_BASE/analytics/outcomes" \
  -H "Authorization: Bearer $TOKEN" | head -c 400
echo ""

echo "Smoke OK (callId=$CALL_ID)."
