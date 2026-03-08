#!/usr/bin/env bash
# Build the Supabase CLI from the patched submodule.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(dirname "$SCRIPT_DIR")"
CLI_DIR="$E2E_DIR/submodules/cli"
BIN_DIR="$E2E_DIR/bin"

if [ ! -d "$CLI_DIR" ]; then
  echo "ERROR: CLI submodule not found at $CLI_DIR"
  exit 1
fi

mkdir -p "$BIN_DIR"

echo "=== Building Supabase CLI ==="
cd "$CLI_DIR"
go build -o "$BIN_DIR/supabase" .

echo "=== CLI built: $BIN_DIR/supabase ==="
"$BIN_DIR/supabase" --version
