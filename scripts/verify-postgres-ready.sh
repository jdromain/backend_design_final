#!/usr/bin/env bash
set -euo pipefail
# Quick check: is Postgres reachable on the default compose URL port?
# Run after: docker compose up -d postgres  OR  bash scripts/fresh-demo-postgres.sh

if command -v nc >/dev/null 2>&1; then
  if nc -z 127.0.0.1 5432 2>/dev/null; then
    echo "OK: something is listening on 127.0.0.1:5432"
    exit 0
  fi
elif bash -c 'echo > /dev/tcp/127.0.0.1/5432' 2>/dev/null; then
  echo "OK: something is listening on 127.0.0.1:5432"
  exit 0
fi

echo "Postgres is not reachable on 127.0.0.1:5432." >&2
echo "Start it from the repo root: bash scripts/fresh-demo-postgres.sh" >&2
echo "  or: docker compose up -d postgres" >&2
exit 1
