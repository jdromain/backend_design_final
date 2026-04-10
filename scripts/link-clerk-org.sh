#!/usr/bin/env bash
set -euo pipefail
# Ensures a Clerk org id exists as the canonical organization id in Postgres.
#
# Usage:
#   bash scripts/link-clerk-org.sh org_XXXXXXXXXXXXXXXXXXXX

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ORG_ID="${1:-}"
if [[ -z "$ORG_ID" ]]; then
  echo "Usage: bash scripts/link-clerk-org.sh <clerk-org-id>" >&2
  exit 1
fi

if [[ ! "$ORG_ID" =~ ^org_ ]]; then
  echo "ERROR: Org ID must start with 'org_' (got: $ORG_ID)" >&2
  exit 1
fi

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

use_docker=false
if command -v docker >/dev/null 2>&1 && docker compose exec -T postgres pg_isready -U rezovo >/dev/null 2>&1; then
  use_docker=true
fi

PGURL=""
if [[ -f "$ROOT/apps/platform-api/.env" ]]; then
  PGURL=$(grep -E '^[[:space:]]*DATABASE_URL=' "$ROOT/apps/platform-api/.env" | head -1 \
    | sed 's/^[[:space:]]*DATABASE_URL=//' | tr -d '"' | tr -d "'")
fi

run_sql() {
  local sql="$1"
  if [[ "$use_docker" == true ]]; then
    docker compose exec -T postgres psql -U rezovo -d rezovo -v ON_ERROR_STOP=1 -c "$sql"
  elif [[ -n "$PGURL" ]] && command -v psql >/dev/null 2>&1; then
    psql "$PGURL" -v ON_ERROR_STOP=1 -c "$sql"
  else
    echo "ERROR: Cannot connect to Postgres. Start Docker Compose postgres or set DATABASE_URL." >&2
    exit 1
  fi
}

echo "==> Ensuring organization '$ORG_ID' exists..."
run_sql "
INSERT INTO public.organizations (id, name, business_id, business_name, status, updated_at)
VALUES ('$ORG_ID', '$ORG_ID', 'business-$ORG_ID', '$ORG_ID', 'active', now())
ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  updated_at = now();"

echo "==> Verifying..."
if [[ "$use_docker" == true ]]; then
  result=$(docker compose exec -T postgres psql -U rezovo -d rezovo -tAc \
    "SELECT id FROM public.organizations WHERE id='$ORG_ID' AND status='active';" | tr -d '[:space:]')
else
  result=$(psql "$PGURL" -tAc \
    "SELECT id FROM public.organizations WHERE id='$ORG_ID' AND status='active';" | tr -d '[:space:]')
fi

if [[ "$result" == "$ORG_ID" ]]; then
  echo "Organization is active and ready: $ORG_ID"
else
  echo "ERROR: Could not verify active organization $ORG_ID" >&2
  exit 1
fi
