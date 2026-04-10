#!/usr/bin/env bash
set -euo pipefail
# Confirms Postgres and verifies canonical org-id schema for local testing.

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

run_query() {
  local sql="$1"
  if [[ "$use_docker" == true ]]; then
    docker compose exec -T postgres psql -U rezovo -d rezovo -tAc "$sql" | tr -d '[:space:]'
  elif [[ -n "$PGURL" ]] && command -v psql >/dev/null 2>&1; then
    psql "$PGURL" -tAc "$sql" | tr -d '[:space:]'
  else
    echo "ERROR: cannot connect to Postgres" >&2
    exit 1
  fi
}

org_table=$(run_query "SELECT to_regclass('public.organizations') IS NOT NULL;")
if [[ "$org_table" != "t" ]]; then
  echo "ERROR: public.organizations table missing. Run: bash scripts/apply-database.sh" >&2
  exit 1
fi
echo "OK: public.organizations exists."

legacy_table=$(run_query "SELECT to_regclass('public.tenants') IS NOT NULL;")
if [[ "$legacy_table" == "t" ]]; then
  echo "ERROR: legacy public.tenants table still exists. Run org-id cutover migration." >&2
  exit 1
fi
echo "OK: legacy public.tenants is absent."

legacy_col_count=$(run_query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='organizations' AND column_name='clerk_organization_id';")
if [[ "$legacy_col_count" != "0" ]]; then
  echo "ERROR: deprecated organizations.clerk_organization_id still exists. Run org-id cutover migration." >&2
  exit 1
fi
echo "OK: organizations.clerk_organization_id is absent."

active_non_org=$(run_query "SELECT COUNT(*) FROM public.organizations WHERE status='active' AND id !~ '^org_[A-Za-z0-9]+$';")
if [[ "$active_non_org" != "0" ]]; then
  echo "ERROR: active organizations contain non-org ids." >&2
  exit 1
fi
echo "OK: all active organizations use org_* ids."

seed_user=$(run_query "SELECT COUNT(*) FROM public.users WHERE email='admin@example.com' AND status='active';")
if [[ "$seed_user" == "0" ]]; then
  echo "WARN: seed user admin@example.com missing. This is fine if using Clerk-only real users." >&2
else
  echo "OK: seed user admin@example.com present."
fi

exit 0
