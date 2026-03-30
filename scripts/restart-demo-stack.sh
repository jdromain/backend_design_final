#!/usr/bin/env bash
set -euo pipefail
# One-shot: free dev ports, ensure Postgres is up (Docker), verify port 5432.
# Then start rtp-bridge, realtime-core, platform-api, and Next in the background.
# From repo root: bash scripts/restart-demo-stack.sh

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Free ports 3000 / 3001 / 3002 / 8080 / 8081"
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

RTP_LOG=/tmp/rezovo-dev-rtp.log
RTC_LOG=/tmp/rezovo-dev-rtc.log
API_LOG=/tmp/rezovo-dev-api.log
WEB_LOG=/tmp/rezovo-dev-web.log

# rtp-bridge is a Go binary — build if needed then run
echo "==> Starting rtp-bridge (background) → $RTP_LOG"
RTP_DIR="$ROOT/apps/rtp-bridge"
if [[ ! -x "$RTP_DIR/rtp-bridge" ]]; then
  echo "    rtp-bridge binary not found — building..."
  (cd "$RTP_DIR" && go build -o rtp-bridge . 2>&1) || {
    echo "WARN: rtp-bridge build failed — skipping (Twilio media will not work)" >&2
    touch /tmp/rezovo-dev-rtp.pid
  }
fi
if [[ -x "$RTP_DIR/rtp-bridge" ]]; then
  nohup "$RTP_DIR/rtp-bridge" >"$RTP_LOG" 2>&1 &
  echo $! > /tmp/rezovo-dev-rtp.pid
fi

echo "==> Starting realtime-core (background) → $RTC_LOG"
nohup pnpm --filter @rezovo/realtime-core dev >"$RTC_LOG" 2>&1 &
echo $! > /tmp/rezovo-dev-rtc.pid

echo "==> Starting platform-api (background) → $API_LOG"
nohup pnpm dev:api >"$API_LOG" 2>&1 &
echo $! > /tmp/rezovo-dev-api.pid

echo "==> Starting frontend (background) → $WEB_LOG"
nohup pnpm dev:web >"$WEB_LOG" 2>&1 &
echo $! > /tmp/rezovo-dev-web.pid

echo "==> Wait for HTTP"
for _ in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:8080/healthz" >/dev/null 2>&1; then
    echo "OK: GET http://127.0.0.1:8080/healthz (rtp-bridge)"
    break
  fi
  sleep 1
done
for _ in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:3002/health" >/dev/null 2>&1; then
    echo "OK: GET http://127.0.0.1:3002/health (realtime-core)"
    break
  fi
  sleep 1
done
for _ in $(seq 1 45); do
  if curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
    echo "OK: GET http://127.0.0.1:3001/health (platform-api)"
    break
  fi
  sleep 1
done
for _ in $(seq 1 45); do
  if curl -sf -o /dev/null "http://127.0.0.1:3000/" 2>/dev/null; then
    echo "OK: GET http://127.0.0.1:3000/ (frontend)"
    break
  fi
  sleep 1
done

echo ""
echo "Done. Open http://localhost:3000/dev-login (admin@example.com)"
echo "Logs: tail -f $RTP_LOG $RTC_LOG $API_LOG $WEB_LOG"
echo "Stop: kill \$(cat /tmp/rezovo-dev-rtp.pid) \$(cat /tmp/rezovo-dev-rtc.pid) \$(cat /tmp/rezovo-dev-api.pid) \$(cat /tmp/rezovo-dev-web.pid)"
