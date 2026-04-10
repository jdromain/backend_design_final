#!/usr/bin/env bash
set -euo pipefail
# Clerk auth smoke test for platform-api (org-id canonical mode).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_BASE="${API_BASE:-http://localhost:3001}"
ORG_ID="${ORG_ID:-}"
UNAUTH_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --unauth-only) UNAUTH_ONLY=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

PASS=0
FAIL=0

ok()   { echo "  PASS: $1"; ((PASS++)) || true; }
fail() { echo "  FAIL: $1" >&2; ((FAIL++)) || true; }
skip() { echo "  SKIP: $1"; }

http_status() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

echo ""
echo "==> 1. Infrastructure"

status=$(http_status "$API_BASE/ready" 2>/dev/null || echo "000")
if [[ "$status" == "200" ]]; then
  ok "GET /ready -> 200"
else
  fail "GET /ready -> $status"
fi

status=$(http_status "$API_BASE/health" 2>/dev/null || echo "000")
if [[ "$status" == "200" ]] || [[ "$status" == "207" ]]; then
  ok "GET /health -> $status"
else
  fail "GET /health -> $status"
fi

echo ""
echo "==> 2. Auth enforcement"
for endpoint in "/calls" "/analytics/outcomes" "/analytics/sparklines" "/incidents" "/onboarding" "/activity"; do
  status=$(http_status "$API_BASE$endpoint" 2>/dev/null || echo "000")
  if [[ "$status" == "401" ]]; then
    ok "GET $endpoint (no token) -> 401"
  else
    fail "GET $endpoint (no token) -> $status (expected 401)"
  fi
done

echo ""
echo "==> 3. Database org canonical checks"

use_docker=false
if command -v docker >/dev/null 2>&1 && docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
  use_docker=true
fi

PGURL=""
if [[ -f "$ROOT/apps/platform-api/.env" ]]; then
  PGURL=$(grep -E '^[[:space:]]*DATABASE_URL=' "$ROOT/apps/platform-api/.env" | head -1 \
    | sed 's/^[[:space:]]*DATABASE_URL=//' | tr -d '"' | tr -d "'")
fi

run_query() {
  if [[ "$use_docker" == true ]]; then
    docker compose exec -T postgres psql -U rezovo -d rezovo -tAc "$1" 2>/dev/null | tr -d '[:space:]'
  elif [[ -n "$PGURL" ]] && command -v psql >/dev/null 2>&1; then
    psql "$PGURL" -tAc "$1" 2>/dev/null | tr -d '[:space:]'
  else
    echo "UNAVAILABLE"
  fi
}

if [[ -z "$ORG_ID" ]]; then
  ORG_ID=$(run_query "SELECT id FROM public.organizations WHERE status='active' ORDER BY created_at ASC LIMIT 1;")
fi

org_exists=$(run_query "SELECT COUNT(*) FROM public.organizations WHERE id='$ORG_ID' AND status='active';")
if [[ "$org_exists" == "1" ]]; then
  ok "organization exists: $ORG_ID"
else
  fail "organization missing/inactive: $ORG_ID"
fi

legacy_table=$(run_query "SELECT to_regclass('public.tenants') IS NOT NULL;")
if [[ "$legacy_table" == "f" ]]; then
  ok "legacy tenants table removed"
else
  fail "legacy tenants table still present"
fi

echo ""
echo "==> 4. Authenticated requests"

if [[ "$UNAUTH_ONLY" == true ]]; then
  skip "Skipping authenticated tests (--unauth-only)"
elif [[ -z "${CLERK_BEARER:-}" ]]; then
  skip "No CLERK_BEARER set — skipping authenticated tests"
else
  for endpoint in "/auth/me" "/calls" "/analytics/outcomes" "/incidents" "/onboarding" "/activity"; do
    status=$(http_status "$API_BASE$endpoint" -H "Authorization: Bearer $CLERK_BEARER" 2>/dev/null || echo "000")
    if [[ "$status" == "200" ]]; then
      ok "GET $endpoint (Clerk Bearer) -> 200"
    elif [[ "$status" == "403" ]]; then
      fail "GET $endpoint -> 403 (org membership/sync issue)"
    else
      fail "GET $endpoint -> $status"
    fi
  done
fi

echo ""
echo "Smoke results: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
