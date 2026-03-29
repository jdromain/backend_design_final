#!/usr/bin/env bash
set -euo pipefail

# Destroys the local Docker Postgres volume and recreates it so init scripts run:
# supabase/setup_complete.sql, supabase/002_ui_tables.sql (see docker-compose.yml).
# Requires Docker. From repo root or via: bash scripts/fresh-demo-postgres.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found; install Docker or start Postgres another way (see docs/setup.md)." >&2
  exit 1
fi

docker compose down -v
docker compose up -d postgres

echo "Waiting for Postgres (rezovo @ localhost:5432)..."
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
    echo "Postgres is ready."
    if bash "$ROOT/scripts/verify-database-for-testing.sh"; then
      echo "Database checks passed (queries + seeded admin@example.com)."
    else
      echo "WARN: verify-database-for-testing.sh failed — init SQL may still be running; wait a few seconds and run: bash scripts/verify-database-for-testing.sh" >&2
    fi
    echo "Next: pnpm dev:api (terminal 1), pnpm dev:web (terminal 2), then http://localhost:3000/dev-login (admin@example.com)."
    exit 0
  fi
  sleep 1
done

echo "Postgres did not become ready in time." >&2
exit 1
