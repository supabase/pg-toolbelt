#!/usr/bin/env bash
# Clean up e2e test artifacts: stop supabase, remove verdaccio, clean bins.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
SUPABASE_BIN="${E2E_DIR}/bin/supabase"

echo "=== Cleaning up e2e artifacts ==="

# Stop supabase in each test project
for project_dir in "$E2E_DIR"/submodules/*/; do
  if [ -d "${project_dir}supabase" ] && [ -x "$SUPABASE_BIN" ]; then
    echo "Stopping supabase in $(basename "$project_dir")..."
    cd "$project_dir"
    "$SUPABASE_BIN" stop --no-backup 2>/dev/null || true
  fi
done

# Stop verdaccio container
echo "Stopping verdaccio..."
docker rm -f pg-toolbelt-verdaccio 2>/dev/null || true

# Clean Deno cache volume used by edge-runtime
echo "Cleaning Deno cache volume..."
docker volume rm supabase_deno_cache 2>/dev/null || true

# Clean built CLI binary
echo "Cleaning bin directory..."
rm -rf "$E2E_DIR/bin"

# Reset CLI submodule if it exists
if [ -d "$E2E_DIR/submodules/cli" ]; then
  echo "Resetting CLI submodule..."
  cd "$E2E_DIR/submodules/cli"
  git checkout -- . 2>/dev/null || true
fi

echo "=== Cleanup complete ==="
