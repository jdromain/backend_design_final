#!/usr/bin/env bash
set -euo pipefail
# Clerk-first smoke wrapper.
# Use this legacy entrypoint for local smoke checks; it now delegates to the Clerk flow.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Clerk-first mode: running scripts/smoke-clerk.sh"
exec bash "$ROOT/scripts/smoke-clerk.sh" "$@"
