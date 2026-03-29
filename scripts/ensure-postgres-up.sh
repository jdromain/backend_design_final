#!/usr/bin/env bash
set -euo pipefail
# Start Docker Postgres (compose) and confirm DB + seed. Prints ports to open the app.
# From repo root: bash scripts/ensure-postgres-up.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker not found. Install Docker Desktop and ensure it is running, then retry." >&2
  exit 1
fi

echo "==> Starting Postgres (docker compose)"
docker compose up -d postgres

echo "==> Waiting for Postgres to accept connections..."
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
  echo "ERROR: Postgres did not become ready in time." >&2
  exit 1
fi

echo "==> Verifying database and seeded dev user"
bash "$ROOT/scripts/verify-database-for-testing.sh"

echo ""
echo "----------------------------------------------------------------"
echo "Postgres is up."
echo "  Database:  localhost:5432  (user rezovo, db rezovo)"
echo ""
echo "Start the app (two terminals from repo root):"
echo "  pnpm dev:api    → platform-api http://localhost:3001"
echo "  pnpm dev:web    → Next.js      http://localhost:3000"
echo ""
echo "Then open:"
echo "  http://localhost:3000/dev-login   (email: admin@example.com)"
echo "  http://localhost:3001/health      (API status)"
echo "----------------------------------------------------------------"
