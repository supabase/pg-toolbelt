#!/usr/bin/env bash
# Patch the CLI submodule to use local pg-delta version.
# Usage: patch-cli.sh <e2e_version>
set -euo pipefail

E2E_VERSION="${1:?Usage: patch-cli.sh <e2e_version>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
CLI_DIR="$E2E_DIR/submodules/cli"

if [ ! -d "$CLI_DIR" ]; then
  echo "ERROR: CLI submodule not found at $CLI_DIR"
  echo "Run: git submodule update --init e2e/submodules/cli"
  exit 1
fi

echo "=== Patching CLI for NPM_CONFIG_REGISTRY forwarding ==="
cd "$CLI_DIR"

# Apply the patch (allow already-applied)
if ! git apply --check "$E2E_DIR/patches/cli-forward-npm-registry.patch" 2>/dev/null; then
  echo "Patch already applied or does not apply cleanly, trying with --3way..."
  git apply --3way "$E2E_DIR/patches/cli-forward-npm-registry.patch" || {
    echo "WARNING: Patch failed to apply. The CLI may have changed."
    echo "Check if NPM_CONFIG_REGISTRY is already forwarded in pgdelta.go"
    # Continue anyway — the feature may already be upstream
  }
else
  git apply "$E2E_DIR/patches/cli-forward-npm-registry.patch"
fi

echo "=== Patching pg-delta version to ${E2E_VERSION} in pgdelta.ts ==="
TEMPLATE_FILE="$CLI_DIR/internal/db/diff/templates/pgdelta.ts"

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "ERROR: Template file not found: $TEMPLATE_FILE"
  exit 1
fi

# Replace the npm:@supabase/pg-delta@<version> references with our e2e version
sed -i.bak -E "s|npm:@supabase/pg-delta@[^\"]+|npm:@supabase/pg-delta@${E2E_VERSION}|g" "$TEMPLATE_FILE"
rm -f "${TEMPLATE_FILE}.bak"

echo "Patched template:"
grep "pg-delta@" "$TEMPLATE_FILE"

echo "=== CLI patched ==="
