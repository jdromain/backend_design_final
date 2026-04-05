#!/usr/bin/env bash
set -euo pipefail
# Clerk auth smoke test for platform-api.
#
# Prerequisites:
#   - platform-api running with AUTH_MODE=clerk  (pnpm --filter platform-api dev)
#   - Postgres seeded with test-tenant + clerk_organization_id set
#   - CLERK_BEARER set to a valid Clerk JWT (see instructions below)
#
# Getting a Clerk JWT for testing:
#   1. Open http://localhost:3000/sign-in and sign in
#   2. Open browser DevTools → Console
#   3. Run: copy(await window.Clerk.session.getToken({ template: 'platform-api' }))
#      (or without template): copy(await window.Clerk.session.getToken())
#   4. export CLERK_BEARER=<paste token>
#   5. bash scripts/smoke-clerk.sh
#
# Quick unauthenticated test (no token needed):
#   bash scripts/smoke-clerk.sh --unauth-only

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_BASE="${API_BASE:-http://localhost:3001}"
TENANT_ID="${TENANT_ID:-test-tenant}"
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

# ── Helpers ────────────────────────────────────────────────────────────────────
http_status() {
  curl -s -o /dev/null -w "%{http_code}" "$@"
}

# ── 1. Infrastructure checks ───────────────────────────────────────────────────
echo ""
echo "==> 1. Infrastructure"

status=$(http_status "$API_BASE/ready" 2>/dev/null || echo "000")
if [[ "$status" == "200" ]]; then
  ok "GET /ready → 200"
else
  fail "GET /ready → $status (is platform-api running on $API_BASE?)"
fi

status=$(http_status "$API_BASE/health" 2>/dev/null || echo "000")
if [[ "$status" == "200" ]] || [[ "$status" == "207" ]]; then
  ok "GET /health → $status"
else
  fail "GET /health → $status"
fi

# ── 2. Auth enforcement (no token → 401) ──────────────────────────────────────
echo ""
echo "==> 2. Auth enforcement (unauthenticated requests must return 401)"

for endpoint in "/calls" "/analytics/outcomes" "/analytics/sparklines" "/incidents" "/onboarding" "/activity"; do
  status=$(http_status "$API_BASE$endpoint" 2>/dev/null || echo "000")
  if [[ "$status" == "401" ]]; then
    ok "GET $endpoint (no token) → 401"
  else
    fail "GET $endpoint (no token) → $status (expected 401)"
  fi
done

# ── 3. Database state ──────────────────────────────────────────────────────────
echo ""
echo "==> 3. Database: Clerk tenant mapping"

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

col_exists=$(run_query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='clerk_organization_id';")
if [[ "$col_exists" == "1" ]]; then
  ok "tenants.clerk_organization_id column exists"
else
  fail "tenants.clerk_organization_id column missing — run: bash scripts/apply-database.sh"
fi

org_id=$(run_query "SELECT COALESCE(clerk_organization_id,'') FROM public.tenants WHERE id='$TENANT_ID';")
if [[ -n "$org_id" ]]; then
  ok "test-tenant.clerk_organization_id = $org_id"
else
  fail "test-tenant.clerk_organization_id not set — run: bash scripts/link-clerk-org.sh <org-id>"
fi

# ── 4. Authenticated requests (requires CLERK_BEARER) ─────────────────────────
echo ""
echo "==> 4. Authenticated requests"

if [[ "$UNAUTH_ONLY" == true ]]; then
  skip "Skipping authenticated tests (--unauth-only)"
elif [[ -z "${CLERK_BEARER:-}" ]]; then
  echo ""
  echo "  NOTE: Set CLERK_BEARER to test authenticated endpoints."
  echo "        Get a token from your browser after signing in at http://localhost:3000/sign-in:"
  echo ""
  echo "        DevTools Console → run:"
  echo "          copy(await window.Clerk.session.getToken({ template: 'platform-api' }))"
  echo "        then:"
  echo "          export CLERK_BEARER=<pasted-token>"
  echo "          bash scripts/smoke-clerk.sh"
  echo ""
  skip "No CLERK_BEARER set — skipping authenticated tests"
else
  for endpoint in "/calls" "/analytics/outcomes" "/incidents" "/onboarding" "/activity"; do
    status=$(http_status "$API_BASE$endpoint" \
      -H "Authorization: Bearer $CLERK_BEARER" 2>/dev/null || echo "000")
    if [[ "$status" == "200" ]]; then
      ok "GET $endpoint (Clerk Bearer) → 200"
    elif [[ "$status" == "403" ]]; then
      fail "GET $endpoint → 403 (user not provisioned or org not mapped — check API logs)"
    else
      fail "GET $endpoint → $status"
    fi
  done

  clerk_user_count=$(run_query "SELECT COUNT(*) FROM public.users WHERE clerk_id IS NOT NULL AND tenant_id='$TENANT_ID' AND status='active';")
  if [[ "$clerk_user_count" -ge "1" ]] 2>/dev/null; then
    ok "Clerk-provisioned user exists in DB (tenant=$TENANT_ID, count=$clerk_user_count)"
  else
    fail "No Clerk-provisioned user in DB for tenant=$TENANT_ID (expected after first sign-in)"
  fi
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────"
echo "Smoke results: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "Check platform-api logs for details:"
  echo "  tail -f /tmp/rezovo-dev/platform-api.log"
  echo "  or: in your platform-api terminal"
  echo "────────────────────────────────────────────────────────────"
  exit 1
fi
echo "────────────────────────────────────────────────────────────"
