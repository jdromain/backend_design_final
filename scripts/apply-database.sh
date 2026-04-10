#!/usr/bin/env bash
set -euo pipefail
# Re-apply database/*.sql to an EXISTING Postgres (initdb scripts do not run again on old volumes).
#
# Usage:
#   export DATABASE_URL=postgresql://rezovo:rezovo_local@localhost:5432/rezovo
#   bash scripts/apply-database.sh
#
# Or with Docker:
#   docker compose exec -T postgres psql -U rezovo -d rezovo -v ON_ERROR_STOP=1 -f - < database/setup_complete.sql
#   (this script uses psql against DATABASE_URL when set)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PGURL="${DATABASE_URL:-}"
if [[ -z "$PGURL" ]] && [[ -f apps/platform-api/.env ]]; then
  PGURL=$(grep -E '^[[:space:]]*DATABASE_URL=' apps/platform-api/.env | head -1 | sed 's/^[[:space:]]*DATABASE_URL=//' | tr -d '"' | tr -d "'")
fi

if [[ -z "$PGURL" ]]; then
  echo "ERROR: Set DATABASE_URL or define it in apps/platform-api/.env" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found. Install PostgreSQL client tools." >&2
  exit 1
fi

legacy_tenants=$(psql "$PGURL" -tAc "SELECT to_regclass('public.tenants') IS NOT NULL;" | tr -d '[:space:]')
canonical_orgs=$(psql "$PGURL" -tAc "SELECT to_regclass('public.organizations') IS NOT NULL;" | tr -d '[:space:]')

if [[ "$legacy_tenants" == "t" && "$canonical_orgs" != "t" ]]; then
  echo "==> Applying legacy->canonical org rekey migration first"
  psql "$PGURL" -v ON_ERROR_STOP=1 -f "$ROOT/database/006_org_id_canonical_cutover.sql"
fi

for f in setup_complete.sql 002_ui_tables.sql 004_call_failure_type.sql 006_org_id_canonical_cutover.sql; do
  echo "==> Applying database/$f"
  psql "$PGURL" -v ON_ERROR_STOP=1 -f "$ROOT/database/$f"
done

echo "Done. Verify with: bash scripts/verify-database-for-testing.sh"
