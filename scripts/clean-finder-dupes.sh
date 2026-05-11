#!/usr/bin/env bash
#
# Removes macOS Finder / iCloud Drive duplicate files and directories that are
# created when the working copy lives on a synced volume (e.g. ~/Desktop on a
# machine signed into iCloud Drive).
#
# Symptoms this prevents:
#   - tsc errors like:
#       error TS2688: Cannot find type definition file for 'node 2'.
#   - duplicate files such as `index 2.ts` polluting builds.
#
# What it does:
#   - Scans focused, build-relevant locations for entries whose basename ends
#     with " 2" (a single space + the digit 2).
#   - Skips .git, the pnpm content-addressable store, and lockfiles.
#   - Compatible with macOS default bash 3.2 (no mapfile, no associative arrays).
#
# Usage:
#   bash scripts/clean-finder-dupes.sh              # delete (default)
#   DRY_RUN=1 bash scripts/clean-finder-dupes.sh    # preview only
#   FULL=1   bash scripts/clean-finder-dupes.sh     # also scan source dirs

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN="${DRY_RUN:-0}"
FULL="${FULL:-0}"

# Locations that have caused real build breakage.
SCAN_DIRS=(
  "node_modules/@types"
  "frontend/node_modules/@types"
  "apps/platform-api/node_modules/@types"
  "apps/realtime-core/node_modules/@types"
  "apps/jobs/node_modules/@types"
)

if [[ "$FULL" == "1" ]]; then
  SCAN_DIRS+=(
    "apps"
    "packages"
    "frontend/app"
    "frontend/components"
    "frontend/lib"
    "frontend/hooks"
    "scripts"
    "database"
  )
fi

count=0
removed=0

for dir in "${SCAN_DIRS[@]}"; do
  [[ -d "$dir" ]] || continue
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    count=$((count + 1))
    echo "  $entry"
    if [[ "$DRY_RUN" != "1" ]]; then
      if [[ -d "$entry" && ! -L "$entry" ]]; then
        rm -rf -- "$entry"
      else
        rm -f -- "$entry"
      fi
      removed=$((removed + 1))
    fi
  done < <(
    find "$dir" \
      -name "* 2" \
      -not -path "*/.git/*" \
      -not -path "*/node_modules/.pnpm/*" \
      -print 2>/dev/null
  )
done

if [[ "$count" -eq 0 ]]; then
  echo "clean-finder-dupes: no duplicate entries found"
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "clean-finder-dupes: DRY_RUN=1, ${count} entries would be removed"
else
  echo "clean-finder-dupes: removed ${removed} entries"
fi
