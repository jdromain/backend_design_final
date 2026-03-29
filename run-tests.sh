#!/usr/bin/env bash
set -euo pipefail

# Repo-wide tests: platform-api contract (Vitest inject) + frontend API client unit tests.
# Does not start a long-lived backend; integration tests that require port 3001 are opt-in.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

echo "🧪 Rezovo test suite (Phase F)"
echo ""

echo "── platform-api (Fastify inject + TypeBox) ──"
# Use workspace filter + package script so Vitest resolves via pnpm (avoids broken direct vitest.mjs paths).
VITEST=true pnpm --filter @rezovo/platform-api run test
echo ""

echo "── frontend (api client mapping / unwrap) ──"
# `frontend/` lives outside pnpm-workspace.yaml — invoke its package scripts directly.
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "⚠️  frontend/node_modules missing. Run: cd frontend && pnpm install" >&2
  exit 1
fi
(
  cd "$ROOT/frontend"
  # Pass the file to Vitest directly — `pnpm run test -- file` forwards `"--"` as an arg and runs the whole suite.
  pnpm exec vitest run __tests__/api.test.ts
)
echo ""

echo "✅ Core tests passed."
echo ""
echo "Optional: run full frontend Vitest (may fail without backend / broken suites):"
echo "  cd frontend && pnpm vitest run"
echo "Optional: with Postgres + API up, manual smoke checklist: docs/setup.md § Demo smoke checklist"
