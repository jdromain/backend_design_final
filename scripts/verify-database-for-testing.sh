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
  echo "ERROR: expected seeded user admin@example.com (active); count='$count'. Apply supabase/setup_complete.sql then supabase/002_ui_tables.sql, or bash scripts/fresh-demo-postgres.sh for a fresh volume." >&2
  exit 1
fi
echo "OK: seeded dev user admin@example.com is present (JWT /dev-login will work)."

exit 0
