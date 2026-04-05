#!/usr/bin/env bash
set -euo pipefail
# Start Postgres AND Redis via Docker Compose and verify the database.
#
# Use this when you want to run apps natively (hot reload) with infra in Docker.
# For the full Docker stack, use: pnpm stack:up
#                             or: bash scripts/restart-demo-stack.sh
#
# From repo root: bash scripts/ensure-postgres-up.sh

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

echo "==> Starting postgres + redis (docker compose)"
docker compose up -d postgres redis

echo "==> Waiting for postgres..."
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
    echo "    OK: postgres"
    break
  fi
  sleep 1
done

if ! docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
  echo "ERROR: Postgres did not become ready in time." >&2
  exit 1
fi

echo "==> Waiting for redis..."
for _ in $(seq 1 30); do
  if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
    echo "    OK: redis"
    break
  fi
  sleep 1
done

echo "==> Verifying database schema and seed data"
bash "$ROOT/scripts/verify-database-for-testing.sh"

# Detect auth mode from platform-api .env
_auth_mode="dev_jwt"
_env_file="$ROOT/apps/platform-api/.env"
if [[ -f "$_env_file" ]]; then
  _m=$(grep -E '^[[:space:]]*AUTH_MODE=' "$_env_file" | head -1 | sed 's/^[[:space:]]*AUTH_MODE=//' | tr -d '"' | tr -d "'" | tr -d '[:space:]')
  _c=$(grep -E '^[[:space:]]*CLERK_AUTH_ENABLED=' "$_env_file" | head -1 | sed 's/^[[:space:]]*CLERK_AUTH_ENABLED=//' | tr -d '"' | tr -d "'" | tr -d '[:space:]')
  if [[ "$_m" == "clerk" ]] || [[ "$_c" == "true" ]]; then _auth_mode="clerk"; fi
fi

echo ""
echo "────────────────────────────────────────────────────────────"
echo "Infrastructure is ready.  Auth mode: $_auth_mode"
echo ""
echo "  Postgres:  localhost:5432  (user: rezovo, db: rezovo)"
echo "  Redis:     localhost:6379"
echo ""
echo "  Full stack (all services in Docker):"
echo "    pnpm stack:up"
echo "    or: bash scripts/restart-demo-stack.sh"
echo ""
echo "  Native apps (hot reload) + Docker infra:"
echo "    bash scripts/restart-demo-stack.sh --local"
echo ""
if [[ "$_auth_mode" == "clerk" ]]; then
  echo "  Then open: http://localhost:3000/sign-in  (Clerk)"
  echo "  Link org:  bash scripts/link-clerk-org.sh <clerk-org-id>"
else
  echo "  Then open: http://localhost:3000/dev-login  (admin@example.com)"
fi
echo "────────────────────────────────────────────────────────────"
