#!/usr/bin/env bash
set -euo pipefail
# Wipe and recreate only the Postgres data volume, then restart postgres.
#
# This script destroys ALL Postgres data and re-runs the init SQL
# (database/setup_complete.sql + database/002_ui_tables.sql + database/004_call_failure_type.sql + database/006_org_id_canonical_cutover.sql), restoring
# the seeded dev user (admin@example.com).
#
# It does NOT remove Redis or any other named volumes.
#
# From repo root: bash scripts/fresh-demo-postgres.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found. Install Docker Desktop and ensure it is running." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon is not running. Start Docker Desktop and retry." >&2
  exit 1
fi

echo "WARNING: This will permanently destroy all Postgres data in the rezovo_pgdata volume."
echo "         Redis and other services are NOT affected."
echo ""
read -r -p "Continue? [y/N] " confirm
if [[ "${confirm,,}" != "y" ]]; then
  echo "Aborted."
  exit 0
fi

echo "==> Stopping postgres container"
docker compose stop postgres
docker compose rm -f postgres

echo "==> Removing rezovo_pgdata volume"
# The volume name is set explicitly in docker-compose.yml as rezovo_pgdata.
docker volume rm rezovo_pgdata 2>/dev/null || {
  echo "    (Volume not found — may not have existed yet)"
}

echo "==> Starting postgres (init SQL will run automatically)"
docker compose up -d postgres

echo "==> Waiting for postgres to become ready..."
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
    echo "    OK: postgres accepting connections"
    break
  fi
  sleep 1
done

if ! docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
  echo "ERROR: Postgres did not become ready in time." >&2
  exit 1
fi

echo "==> Verifying database schema and seed data"
if bash "$ROOT/scripts/verify-database-for-testing.sh"; then
  echo ""
  echo "────────────────────────────────────────────────────────────"
  echo "Postgres reset complete."
  echo ""
  echo "  Seed user: admin@example.com"
  echo ""
  echo "  Start full stack: pnpm stack:up"
  echo "           or: bash scripts/restart-demo-stack.sh"
  echo "────────────────────────────────────────────────────────────"
else
  echo ""
  echo "WARN: Schema/seed check failed — init SQL may still be running."
  echo "      Wait a few seconds then run: bash scripts/verify-database-for-testing.sh" >&2
fi
