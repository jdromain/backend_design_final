#!/usr/bin/env bash
set -euo pipefail
# Links a Clerk Organization ID to the test-tenant in Postgres.
#
# Run this once after setting up a new Clerk Development environment.
# The Org ID is stable across sessions — you only need to re-run if you
# create a new org or wipe the Postgres volume.
#
# Usage:
#   bash scripts/link-clerk-org.sh org_XXXXXXXXXXXXXXXXXXXX
#
# Find your Org ID in:
#   Clerk Dashboard → Organizations → <your org> → (copy ID from URL or details panel)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ORG_ID="${1:-}"
if [[ -z "$ORG_ID" ]]; then
  echo "Usage: bash scripts/link-clerk-org.sh <clerk-org-id>" >&2
  echo ""
  echo "Find your Org ID in Clerk Dashboard → Organizations → <your org>" >&2
  echo "It looks like: org_XXXXXXXXXXXXXXXXXXXX" >&2
  exit 1
fi

if [[ ! "$ORG_ID" =~ ^org_ ]]; then
  echo "ERROR: Org ID must start with 'org_' (got: $ORG_ID)" >&2
  exit 1
fi

TENANT_ID="${TENANT_ID:-test-tenant}"

export PATH="/usr/local/bin:/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

# ── Resolve how to reach Postgres ─────────────────────────────────────────────
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

echo "==> Ensuring 003_clerk_tenant_mapping.sql migration is applied..."
run_sql "ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS clerk_organization_id TEXT;" >/dev/null
run_sql "CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_clerk_organization_id ON public.tenants (clerk_organization_id) WHERE clerk_organization_id IS NOT NULL;" >/dev/null

echo "==> Linking Clerk org '$ORG_ID' → tenant '$TENANT_ID' ..."
run_sql "UPDATE public.tenants SET clerk_organization_id = '$ORG_ID', updated_at = now() WHERE id = '$TENANT_ID';"

echo ""
echo "==> Verifying..."
if [[ "$use_docker" == true ]]; then
  result=$(docker compose exec -T postgres psql -U rezovo -d rezovo -tAc \
    "SELECT clerk_organization_id FROM public.tenants WHERE id='$TENANT_ID';" | tr -d '[:space:]')
else
  result=$(psql "$PGURL" -tAc \
    "SELECT clerk_organization_id FROM public.tenants WHERE id='$TENANT_ID';" | tr -d '[:space:]')
fi

if [[ "$result" == "$ORG_ID" ]]; then
  echo "────────────────────────────────────────────────────────────"
  echo "Clerk org linked successfully."
  echo ""
  echo "  Tenant:  $TENANT_ID"
  echo "  Org ID:  $ORG_ID"
  echo ""
  echo "Next: sign in at http://localhost:3000/sign-in"
  echo "      platform-api will provision your Clerk user on first request."
  echo "────────────────────────────────────────────────────────────"
else
  echo "ERROR: Update did not take effect. Got: '$result'" >&2
  exit 1
fi
