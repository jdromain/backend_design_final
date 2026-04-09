#!/usr/bin/env bash
set -euo pipefail
# Confirms Postgres is up AND the app database accepts queries with expected demo seed.
# Run from repo root after: docker compose up -d postgres  (or fresh-demo-postgres.sh)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash "$ROOT/scripts/verify-postgres-ready.sh"

PGURL=""
if [[ -f apps/platform-api/.env ]]; then
  PGURL=$(grep -E '^[[:space:]]*DATABASE_URL=' apps/platform-api/.env | head -1 | sed 's/^[[:space:]]*DATABASE_URL=//' | tr -d '"' | tr -d "'")
fi

use_docker=false
if command -v docker >/dev/null 2>&1 && docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
  use_docker=true
fi

if [[ "$use_docker" == true ]]; then
  docker compose exec -T postgres psql -U rezovo -d rezovo -v ON_ERROR_STOP=1 -c "SELECT 1 AS ok;" >/dev/null
  echo "OK: database accepts queries (SELECT 1)."
  count=$(docker compose exec -T postgres psql -U rezovo -d rezovo -tAc "SELECT COUNT(*) FROM public.users WHERE email = 'admin@example.com' AND status = 'active';" | tr -d '[:space:]')
elif [[ -n "$PGURL" ]] && command -v psql >/dev/null 2>&1; then
  psql "$PGURL" -v ON_ERROR_STOP=1 -c "SELECT 1 AS ok;" >/dev/null
  echo "OK: database accepts queries (SELECT 1)."
  count=$(psql "$PGURL" -tAc "SELECT COUNT(*) FROM public.users WHERE email = 'admin@example.com' AND status = 'active';" | tr -d '[:space:]')
else
  echo "ERROR: Postgres is listening but cannot verify schema — start compose Postgres (docker compose up -d postgres) or install psql and set DATABASE_URL in apps/platform-api/.env" >&2
  exit 1
fi

if [[ "$count" != "1" ]]; then
  for _ in $(seq 1 15); do
    sleep 2
    if [[ "$use_docker" == true ]]; then
      count=$(docker compose exec -T postgres psql -U rezovo -d rezovo -tAc "SELECT COUNT(*) FROM public.users WHERE email = 'admin@example.com' AND status = 'active';" | tr -d '[:space:]')
    else
      count=$(psql "$PGURL" -tAc "SELECT COUNT(*) FROM public.users WHERE email = 'admin@example.com' AND status = 'active';" | tr -d '[:space:]')
    fi
    [[ "$count" == "1" ]] && break
  done
fi
if [[ "$count" != "1" ]]; then
  echo "ERROR: expected seeded user admin@example.com (active); count='$count'. Apply database/setup_complete.sql then database/002_ui_tables.sql (see scripts/apply-database.sh), or bash scripts/fresh-demo-postgres.sh for a fresh volume." >&2
  exit 1
fi
echo "OK: seeded user admin@example.com is present for Clerk provisioning/mapping flows."

# ── Clerk tenant mapping check ────────────────────────────────────────────────
echo ""
echo "==> Checking Clerk tenant mapping (003_clerk_tenant_mapping.sql) ..."

clerk_col_exists() {
  local sql="SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='clerk_organization_id';"
  if [[ "$use_docker" == true ]]; then
    docker compose exec -T postgres psql -U rezovo -d rezovo -tAc "$sql" | tr -d '[:space:]'
  else
    psql "$PGURL" -tAc "$sql" | tr -d '[:space:]'
  fi
}

clerk_org_id() {
  local sql="SELECT COALESCE(clerk_organization_id,'') FROM public.tenants WHERE id='test-tenant';"
  if [[ "$use_docker" == true ]]; then
    docker compose exec -T postgres psql -U rezovo -d rezovo -tAc "$sql" | tr -d '[:space:]'
  else
    psql "$PGURL" -tAc "$sql" | tr -d '[:space:]'
  fi
}

col_count=$(clerk_col_exists)
if [[ "$col_count" != "1" ]]; then
  echo "WARN: tenants.clerk_organization_id column missing — run: bash scripts/apply-database.sh" >&2
  echo "      (or: docker compose exec -T postgres psql -U rezovo -d rezovo -f - < database/003_clerk_tenant_mapping.sql)" >&2
else
  echo "OK: tenants.clerk_organization_id column exists."
  org_id=$(clerk_org_id)
  if [[ -z "$org_id" ]]; then
    echo "WARN: test-tenant.clerk_organization_id is not set — Clerk bootstrap org-to-tenant mapping will fail." >&2
    echo "      To fix, run: bash scripts/link-clerk-org.sh <your-clerk-org-id>" >&2
    echo "      (Get your Clerk Org ID from Clerk Dashboard → Organizations)" >&2
  else
    echo "OK: test-tenant mapped to Clerk org $org_id"
  fi
fi

exit 0
