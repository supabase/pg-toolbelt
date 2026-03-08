#!/usr/bin/env bash
# Test: dbdev project with all migrations applied should produce an empty diff.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

DBDEV_DIR="$E2E_DIR/submodules/dbdev"

if [ ! -d "$DBDEV_DIR/supabase" ]; then
  echo "SKIP: dbdev submodule not initialized"
  exit 0
fi

echo "=== Test: dbdev clean diff ==="

start_supabase "$DBDEV_DIR"

# After start, all migrations are applied. Diff should be empty.
assert_empty_diff "$DBDEV_DIR" "app,public"

stop_supabase "$DBDEV_DIR"

echo "=== PASSED: dbdev clean diff ==="
