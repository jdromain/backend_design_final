#!/usr/bin/env bash
set -euo pipefail
# Stop the Rezovo Docker Compose stack.
#
# Usage:
#   bash scripts/stack-down.sh       # stop containers, keep volumes
#   bash scripts/stack-down.sh -v    # stop containers AND remove named volumes
#
# WARNING: Passing -v will destroy the rezovo_pgdata volume and all Postgres data.
#          Use bash scripts/fresh-demo-postgres.sh to reset only Postgres data.
#
# All arguments are passed directly to `docker compose down`.
# From repo root only.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

for arg in "$@"; do
  if [[ "$arg" == "-v" || "$arg" == "--volumes" ]]; then
    echo "WARNING: -v will permanently delete ALL named volumes (including rezovo_pgdata)."
    read -r -p "Continue? [y/N] " confirm
    if [[ "${confirm,,}" != "y" ]]; then
      echo "Aborted."
      exit 0
    fi
    break
  fi
done

exec docker compose down "$@"
