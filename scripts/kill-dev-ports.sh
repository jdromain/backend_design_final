#!/usr/bin/env bash
# Free Next.js (3000) and platform-api (3001) on macOS/Linux.
# macOS: use `lsof -tiTCP:PORT -sTCP:LISTEN` (not `lsof -ti :3000,3001`).

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

for p in 3000 3001; do
  kill_port "$p"
done
