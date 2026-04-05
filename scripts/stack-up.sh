#!/usr/bin/env bash
set -euo pipefail
# Start the full Rezovo Docker Compose stack.
#
# Usage:
#   bash scripts/stack-up.sh               # start with cached images
#   bash scripts/stack-up.sh --build       # rebuild all images first
#   bash scripts/stack-up.sh --no-deps realtime-core  # restart one service
#
# All arguments are passed directly to `docker compose up -d`.
# From repo root only.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/.env.docker" ]]; then
  echo "ERROR: .env.docker not found." >&2
  echo "       Run: cp .env.docker.example .env.docker" >&2
  echo "       Then fill in JWT_SECRET and OPENAI_API_KEY at minimum." >&2
  exit 1
fi

exec docker compose up -d "$@"
