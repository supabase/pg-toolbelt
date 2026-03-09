#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG_DELTA_PKG="$REPO_ROOT/packages/pg-delta/package.json"

cp "$PG_DELTA_PKG" "$PG_DELTA_PKG.bak"
trap 'mv "$PG_DELTA_PKG.bak" "$PG_DELTA_PKG"' EXIT

echo "=== Step 1: Run Deno e2e with fixed package.json (should PASS) ==="
node "$REPO_ROOT/.github/scripts/deno-library-e2e.mjs"
echo "PASS: Deno e2e succeeded with fixed dependency."
