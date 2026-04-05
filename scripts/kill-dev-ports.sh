#!/usr/bin/env bash
# Free all dev ports used by native (non-Docker) Rezovo processes:
#   Next.js (3000), platform-api (3001), realtime-core (3002),
#   rtp-bridge external (8080), rtp-bridge internal (8081), metrics (9090/9100).
#
# NOTE: This kills HOST processes only. It does NOT stop Docker containers.
# To stop Docker services that are binding these same ports, use:
#   docker compose down
#   or: pnpm stack:down
#
# macOS: uses `lsof -tiTCP:PORT -sTCP:LISTEN` (not `lsof -ti :PORT`).

set -euo pipefail

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "Port ${port} in use by PID(s): ${pids} — sending SIGTERM"
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true
    sleep 0.5
    pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      echo "Port ${port} still busy — SIGKILL"
      # shellcheck disable=SC2086
      kill -9 ${pids} 2>/dev/null || true
    fi
  else
    echo "Port ${port} is free"
  fi
}

for p in 3000 3001 3002 8080 8081 9090 9100; do
  kill_port "$p"
done
