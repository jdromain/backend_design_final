#!/usr/bin/env bash
set -euo pipefail
# Rezovo developer stack entrypoint.
#
# Usage:
#   bash scripts/restart-demo-stack.sh           # Docker mode (default)
#   bash scripts/restart-demo-stack.sh --build   # Docker mode + force image rebuild
#   bash scripts/restart-demo-stack.sh --local   # Local mode: infra in Docker, apps via pnpm
#
# Docker mode:  runs every service inside Compose. Requires .env.docker.
# Local mode:   runs only postgres + redis in Compose; apps run via pnpm with hot reload.
#               Good for rapid iteration on a single service.
#
# From repo root only.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ─── Parse flags ─────────────────────────────────────────────────────────────
MODE="docker"
BUILD_FLAG=""
for arg in "$@"; do
  case "$arg" in
    --local) MODE="local" ;;
    --build) BUILD_FLAG="--build" ;;
    --no-build) BUILD_FLAG="--no-build" ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ─── Helpers ──────────────────────────────────────────────────────────────────
wait_http() {
  local label="$1" url="$2" timeout="${3:-60}"
  echo "==> Waiting for $label ($url) ..."
  for _ in $(seq 1 "$timeout"); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      echo "    OK: $label"
      return 0
    fi
    sleep 1
  done
  echo "    WARN: $label did not respond within ${timeout}s — check logs" >&2
  return 0  # non-fatal; full health is confirmed by verify scripts
}

require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker not found. Install Docker Desktop and ensure it is running." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: Docker daemon is not running. Start Docker Desktop and retry." >&2
    exit 1
  fi
}

# ─── Docker mode ──────────────────────────────────────────────────────────────
if [[ "$MODE" == "docker" ]]; then
  require_docker

  if [[ ! -f "$ROOT/.env.docker" ]]; then
    echo "ERROR: .env.docker not found." >&2
    echo "       Run: cp .env.docker.example .env.docker" >&2
    echo "       Then fill in Clerk keys and OPENAI_API_KEY at minimum." >&2
    exit 1
  fi

  echo "==> Starting full Rezovo stack (Docker Compose)"
  # shellcheck disable=SC2086
  docker compose up -d $BUILD_FLAG

  wait_http "rtp-bridge"    "http://127.0.0.1:8080/healthz" 45
  wait_http "platform-api"  "http://127.0.0.1:3001/health"  90
  wait_http "realtime-core" "http://127.0.0.1:3002/health"  120
  wait_http "frontend"      "http://127.0.0.1:3000/"        60

  echo "==> Verifying database seed..."
  bash "$ROOT/scripts/verify-database-for-testing.sh" || \
    echo "WARN: DB seed check failed — run: bash scripts/fresh-demo-postgres.sh" >&2

  _auth_mode="clerk"

  echo ""
  echo "────────────────────────────────────────────────────────────"
  echo "Stack is up.  Auth mode: $_auth_mode"
  echo ""
  echo "  Dashboard:   http://localhost:3000"
  echo "  Sign in:     http://localhost:3000/sign-in  (Clerk)"
  echo "               Ensure JWT template 'platform-api' exists in Clerk Dashboard"
  echo "  API health:  http://localhost:3001/health"
  echo "  Webhook:     http://localhost:3002/health"
  echo ""
  echo "  Logs:        pnpm stack:logs"
  echo "  Stop:        pnpm stack:down  (or: docker compose down)"
  echo "────────────────────────────────────────────────────────────"
  exit 0
fi

# ─── Local mode ───────────────────────────────────────────────────────────────
if [[ "$MODE" == "local" ]]; then
  require_docker

  echo "==> Local mode: starting postgres + redis in Docker, apps via pnpm"
  docker compose up -d postgres redis

  echo "==> Waiting for postgres..."
  for _ in $(seq 1 60); do
    if docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
      echo "    OK: postgres"
      break
    fi
    sleep 1
  done

  echo "==> Waiting for redis..."
  for _ in $(seq 1 30); do
    if docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
      echo "    OK: redis"
      break
    fi
    sleep 1
  done

  bash "$ROOT/scripts/verify-database-for-testing.sh" || \
    echo "WARN: DB seed check failed — run: bash scripts/fresh-demo-postgres.sh" >&2

  echo "==> pnpm install"
  pnpm install

  echo "==> Freeing dev ports"
  bash "$ROOT/scripts/kill-dev-ports.sh" || true

  LOGDIR="/tmp/rezovo-dev"
  mkdir -p "$LOGDIR"

  # rtp-bridge (Go binary)
  RTP_DIR="$ROOT/apps/rtp-bridge"
  if [[ ! -x "$RTP_DIR/rtp-bridge" ]]; then
    echo "==> Building rtp-bridge binary..."
    (cd "$RTP_DIR" && go build -o rtp-bridge . 2>&1) || {
      echo "WARN: rtp-bridge build failed — Twilio media will not work" >&2
    }
  fi
  if [[ -x "$RTP_DIR/rtp-bridge" ]]; then
    echo "==> Starting rtp-bridge -> $LOGDIR/rtp-bridge.log"
    nohup "$RTP_DIR/rtp-bridge" >"$LOGDIR/rtp-bridge.log" 2>&1 &
    echo $! >"$LOGDIR/rtp-bridge.pid"
  fi

  echo "==> Starting realtime-core -> $LOGDIR/realtime-core.log"
  nohup pnpm --filter @rezovo/realtime-core dev >"$LOGDIR/realtime-core.log" 2>&1 &
  echo $! >"$LOGDIR/realtime-core.pid"

  echo "==> Starting platform-api -> $LOGDIR/platform-api.log"
  nohup pnpm --filter @rezovo/platform-api dev >"$LOGDIR/platform-api.log" 2>&1 &
  echo $! >"$LOGDIR/platform-api.pid"

  echo "==> Starting jobs -> $LOGDIR/jobs.log"
  nohup pnpm --filter @rezovo/jobs start >"$LOGDIR/jobs.log" 2>&1 &
  echo $! >"$LOGDIR/jobs.pid"

  echo "==> Starting frontend -> $LOGDIR/frontend.log"
  nohup pnpm --filter frontend dev >"$LOGDIR/frontend.log" 2>&1 &
  echo $! >"$LOGDIR/frontend.pid"

  wait_http "rtp-bridge"    "http://127.0.0.1:8080/healthz" 45
  wait_http "platform-api"  "http://127.0.0.1:3001/health"  90
  wait_http "realtime-core" "http://127.0.0.1:3002/health"  120
  wait_http "frontend"      "http://127.0.0.1:3000/"        60

  _auth_mode="clerk"

  echo ""
  echo "────────────────────────────────────────────────────────────"
  echo "Local stack is up (infra in Docker, apps via pnpm)."
  echo "Auth mode: $_auth_mode"
  echo ""
  echo "  Dashboard:   http://localhost:3000"
  echo "  Sign in:     http://localhost:3000/sign-in  (Clerk)"
  echo "               Ensure JWT template 'platform-api' exists in Clerk Dashboard"
  echo "  Smoke test:  bash scripts/smoke-clerk.sh --unauth-only"
  echo "  API health:  http://localhost:3001/health"
  echo ""
  echo "  Logs:        tail -f $LOGDIR/*.log"
  echo "  Stop apps:   kill \$(cat $LOGDIR/*.pid 2>/dev/null)"
  echo "  Stop infra:  docker compose stop postgres redis"
  echo "────────────────────────────────────────────────────────────"
  exit 0
fi
