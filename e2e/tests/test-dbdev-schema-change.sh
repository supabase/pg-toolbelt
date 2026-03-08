#!/usr/bin/env bash
# Test: dbdev project detects a manually-applied schema change in the diff.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

DBDEV_DIR="$E2E_DIR/submodules/dbdev"

if [ ! -d "$DBDEV_DIR/supabase" ]; then
  echo "SKIP: dbdev submodule not initialized"
  exit 0
fi

echo "=== Test: dbdev schema change detection ==="

start_supabase "$DBDEV_DIR"

# Create a test table directly in the database
local_psql "$DBDEV_DIR" "CREATE TABLE public.e2e_test_table (id serial PRIMARY KEY, name text NOT NULL);"

# Diff should detect the new table
assert_diff_contains "$DBDEV_DIR" "CREATE TABLE.*e2e_test_table" "app,public"

# Clean up
local_psql "$DBDEV_DIR" "DROP TABLE public.e2e_test_table;"

stop_supabase "$DBDEV_DIR"

echo "=== PASSED: dbdev schema change detection ==="
