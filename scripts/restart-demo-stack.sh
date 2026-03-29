#!/usr/bin/env bash
set -euo pipefail
# One-shot: free dev ports, ensure Postgres is up (Docker), verify port 5432.
# Then start platform-api and Next in the background (logs under /tmp).
# From repo root: bash scripts/restart-demo-stack.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Free ports 3000 / 3001"
pnpm kill-ports 2>/dev/null || bash scripts/kill-dev-ports.sh || true

if command -v docker >/dev/null 2>&1; then
  echo "==> Docker: start Postgres (compose)"
  docker compose up -d postgres
  echo "==> Wait for Postgres"
  for _ in $(seq 1 45); do
    if bash scripts/verify-postgres-ready.sh 2>/dev/null; then
      echo "Postgres OK."
      break
    fi
    sleep 1
  done
  bash scripts/verify-postgres-ready.sh 2>/dev/null || echo "WARN: Postgres still not on 5432 — dev-login and some API routes need it." >&2
  if bash scripts/verify-database-for-testing.sh 2>/dev/null; then
    echo "Database OK for testing."
  else
    echo "WARN: DB schema/seed check failed — fix Postgres or run bash scripts/fresh-demo-postgres.sh" >&2
  fi
else
  echo "WARN: docker not in PATH — start Postgres manually (see docs/setup.md)." >&2
  bash scripts/verify-postgres-ready.sh 2>/dev/null || echo "WARN: Postgres not on 5432 yet." >&2
fi

echo "==> pnpm install (quick)"
pnpm install

API_LOG=/tmp/rezovo-dev-api.log
WEB_LOG=/tmp/rezovo-dev-web.log
echo "==> Starting platform-api (background) → $API_LOG"
nohup pnpm dev:api >"$API_LOG" 2>&1 &
echo $! > /tmp/rezovo-dev-api.pid
echo "==> Starting frontend (background) → $WEB_LOG"
nohup pnpm dev:web >"$WEB_LOG" 2>&1 &
echo $! > /tmp/rezovo-dev-web.pid

echo "==> Wait for HTTP"
for _ in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
    echo "OK: GET http://127.0.0.1:3001/health"
    break
  fi
  sleep 1
done
for _ in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:3000/" 2>/dev/null; then
    echo "OK: GET http://127.0.0.1:3000/"
    break
  fi
  sleep 1
done

echo ""
echo "Done. Open http://localhost:3000/dev-login (admin@example.com)"
echo "Logs: tail -f $API_LOG $WEB_LOG"
echo "Stop: kill \$(cat /tmp/rezovo-dev-api.pid) \$(cat /tmp/rezovo-dev-web.pid)  # or pnpm kill-ports"
