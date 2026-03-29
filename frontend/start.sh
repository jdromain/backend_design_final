#!/usr/bin/env bash
# Run from repo root: install once with `pnpm install`, then either:
#   ./frontend/start.sh
# or from this directory after `cd frontend`.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$(dirname "$0")"

echo "Rezovo frontend — local dev"
echo ""

if [[ ! -d "node_modules" ]]; then
  echo "Installing dependencies (from monorepo root recommended)..."
  (cd "$ROOT" && pnpm install)
fi

if [[ ! -f ".env.local" ]]; then
  echo "Creating .env.local with API URL defaults..."
  cat > .env.local << 'EOF'
# platform-api base (both names supported: lib/api.ts + lib/api-client.ts)
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001

# Optional Clerk — leave empty to use JWT dev login without Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Optional: frontend can use mock data layers when API is down (see lib/data/_env-check)
# NEXT_PUBLIC_USE_MOCKS=true
EOF
  echo "Created .env.local"
  echo ""
fi

echo "Prerequisites:"
echo "  1. platform-api on http://localhost:3001 (see apps/platform-api/env.example)"
echo "  2. Postgres running if you want real data (otherwise API logs a DB warning but still listens)"
echo "  3. If port 3001 or 3000 is busy, from repo root run: pnpm kill-ports"
echo ""
echo "Login: http://localhost:3000/dev-login (email only — matches POST /auth/login)"
echo ""

pnpm run dev
