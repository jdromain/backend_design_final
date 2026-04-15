#!/usr/bin/env bash
set -euo pipefail
# Tail logs from Rezovo application services.
#
# Usage:
#   bash scripts/stack-logs.sh                   # all app services (default)
#   bash scripts/stack-logs.sh platform-api      # single service
#   bash scripts/stack-logs.sh jobs realtime-core # multiple services
#
# Postgres and redis are excluded from the default set because their logs are
# rarely useful during application development. Pass them explicitly if needed.
# From repo root only.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMPOSE_ARGS=()
if [[ -f "$ROOT/.env.docker" ]]; then
  COMPOSE_ARGS+=(--env-file "$ROOT/.env.docker")
fi

# Default to all application services (not infra).
if [[ $# -eq 0 ]]; then
  exec docker compose "${COMPOSE_ARGS[@]}" logs -f --tail=100 platform-api realtime-core jobs rtp-bridge frontend
else
  exec docker compose "${COMPOSE_ARGS[@]}" logs -f --tail=100 "$@"
fi
