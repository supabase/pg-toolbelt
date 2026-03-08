#!/usr/bin/env bash
# Main e2e orchestrator: build → publish → patch → test → cleanup.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$E2E_DIR/.." && pwd)"

# Ensure cleanup runs on exit
cleanup() {
  echo ""
  echo "=== Running cleanup ==="
  bash "$SCRIPT_DIR/cleanup.sh"
}
trap cleanup EXIT

export NPM_CONFIG_REGISTRY="${NPM_CONFIG_REGISTRY:-http://localhost:4873}"

echo "========================================"
echo " pg-delta E2E Pipeline"
echo "========================================"
echo ""

# Step 1: Start verdaccio
echo "--- Step 1/6: Start verdaccio ---"
bash "$SCRIPT_DIR/setup-verdaccio.sh"
echo ""

# Step 2: Build and publish packages
echo "--- Step 2/6: Build and publish packages ---"
# Source so we get E2E_VERSION exported
source "$SCRIPT_DIR/build-and-publish.sh"
echo ""

# Step 3: Patch CLI
echo "--- Step 3/6: Patch CLI ---"
bash "$SCRIPT_DIR/patch-cli.sh" "$E2E_VERSION"
echo ""

# Step 4: Build CLI
echo "--- Step 4/6: Build CLI ---"
bash "$SCRIPT_DIR/build-cli.sh"
echo ""

# Step 5: Clear Deno cache volume to avoid stale npm resolutions
echo "--- Step 5/6: Clear Deno cache ---"
docker volume rm supabase_deno_cache 2>/dev/null || true
echo "Deno cache volume cleared."
echo ""

# Step 6: Run tests
echo "--- Step 6/6: Run tests ---"
export SUPABASE_BIN="$E2E_DIR/bin/supabase"

PASS=0
FAIL=0
SKIP=0

for test_file in "$E2E_DIR"/tests/test-*.sh; do
  test_name="$(basename "$test_file" .sh)"
  echo ""
  echo "========================================"
  echo " Running: $test_name"
  echo "========================================"

  if bash "$test_file"; then
    PASS=$((PASS + 1))
  else
    exit_code=$?
    if [ $exit_code -eq 0 ]; then
      SKIP=$((SKIP + 1))
    else
      FAIL=$((FAIL + 1))
      echo "FAILED: $test_name (exit code $exit_code)"
    fi
  fi
done

echo ""
echo "========================================"
echo " E2E Results: $PASS passed, $FAIL failed, $SKIP skipped"
echo "========================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
