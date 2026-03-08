#!/usr/bin/env bash
# Shared helpers for e2e test scripts.
# Source this file from test-*.sh scripts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
SUPABASE_BIN="${SUPABASE_BIN:-$E2E_DIR/bin/supabase}"

if [ ! -x "$SUPABASE_BIN" ]; then
  echo "ERROR: supabase binary not found at $SUPABASE_BIN"
  exit 1
fi

# Start supabase in the given project directory.
# Usage: start_supabase <project_dir>
start_supabase() {
  local project_dir="${1:?Usage: start_supabase <project_dir>}"
  echo "  Starting supabase in $(basename "$project_dir")..."
  cd "$project_dir"
  "$SUPABASE_BIN" start
}

# Stop supabase in the given project directory.
# Usage: stop_supabase <project_dir>
stop_supabase() {
  local project_dir="${1:?Usage: stop_supabase <project_dir>}"
  echo "  Stopping supabase in $(basename "$project_dir")..."
  cd "$project_dir"
  "$SUPABASE_BIN" stop --no-backup 2>/dev/null || true
}

# Run db diff --use-pg-delta and capture output.
# Usage: run_diff <project_dir> [schemas...]
# Outputs diff SQL to stdout, returns exit code from supabase.
run_diff() {
  local project_dir="${1:?Usage: run_diff <project_dir> [schemas...]}"
  shift
  local schemas="${*:-}"

  cd "$project_dir"

  local diff_args=("db" "diff" "--use-pg-delta" "--local")
  if [ -n "$schemas" ]; then
    diff_args+=("--schema" "$schemas")
  fi

  "$SUPABASE_BIN" "${diff_args[@]}" 2>/dev/null || true
}

# Assert that db diff produces empty output (no schema drift).
# Usage: assert_empty_diff <project_dir> [schemas...]
assert_empty_diff() {
  local project_dir="${1:?Usage: assert_empty_diff <project_dir> [schemas...]}"
  shift
  local schemas="${*:-}"

  echo "  Asserting empty diff..."
  local diff_output
  diff_output="$(run_diff "$project_dir" "$schemas")"

  # Trim whitespace
  diff_output="$(echo "$diff_output" | sed '/^$/d' | xargs)"

  if [ -n "$diff_output" ]; then
    echo "  FAIL: Expected empty diff but got:"
    echo "$diff_output"
    return 1
  fi

  echo "  PASS: Diff is empty."
}

# Assert that db diff produces non-empty output.
# Usage: assert_nonempty_diff <project_dir> [schemas...]
assert_nonempty_diff() {
  local project_dir="${1:?Usage: assert_nonempty_diff <project_dir> [schemas...]}"
  shift
  local schemas="${*:-}"

  echo "  Asserting non-empty diff..."
  local diff_output
  diff_output="$(run_diff "$project_dir" "$schemas")"

  diff_output="$(echo "$diff_output" | sed '/^$/d' | xargs)"

  if [ -z "$diff_output" ]; then
    echo "  FAIL: Expected non-empty diff but got nothing."
    return 1
  fi

  echo "  PASS: Diff is non-empty."
}

# Assert that db diff output contains a pattern.
# Usage: assert_diff_contains <project_dir> <pattern> [schemas...]
assert_diff_contains() {
  local project_dir="${1:?Usage: assert_diff_contains <project_dir> <pattern> [schemas...]}"
  local pattern="${2:?Usage: assert_diff_contains <project_dir> <pattern> [schemas...]}"
  shift 2
  local schemas="${*:-}"

  echo "  Asserting diff contains '$pattern'..."
  local diff_output
  diff_output="$(run_diff "$project_dir" "$schemas")"

  if ! echo "$diff_output" | grep -qE "$pattern"; then
    echo "  FAIL: Diff does not contain pattern '$pattern'."
    echo "  Actual diff output:"
    echo "$diff_output"
    return 1
  fi

  echo "  PASS: Diff contains '$pattern'."
}

# Get the psql connection string for the local supabase db.
# Usage: local_psql <project_dir> [sql_command]
local_psql() {
  local project_dir="${1:?Usage: local_psql <project_dir> [sql_command]}"
  local sql="${2:-}"

  cd "$project_dir"
  local db_url
  db_url="$("$SUPABASE_BIN" status -o env 2>/dev/null | grep DB_URL | cut -d= -f2-)"

  if [ -z "$db_url" ]; then
    echo "ERROR: Could not get DB_URL from supabase status"
    return 1
  fi

  if [ -n "$sql" ]; then
    psql "$db_url" -c "$sql"
  else
    echo "$db_url"
  fi
}
