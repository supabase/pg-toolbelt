#!/bin/bash
set -e

CONTAINER_NAME="pgdelta-dogfooding"
CONTAINER_PORT=6544
ADMIN_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/postgres"
DB_NAME="postgres"
DB_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/${DB_NAME}"

TARGET_URL="${TARGET_URL:-postgres://postgres:postgres@db.platform.orb.local:5432/postgres}"
OUTPUT_DIR="${OUTPUT_DIR:-./declarative-schemas}"
BASELINE_SNAPSHOT="${BASELINE_SNAPSHOT:-./baseline-catalog.json}"
FILTER_DSL="${FILTER_DSL:-$DEFAULT_FILTER}"

# Same format options as scripts/declarative-export.ts
FORMAT_OPTIONS='{"keywordCase":"lower","maxWidth":180,"indent":4}'
## Same group patterns as scripts/declarative-export.ts (pattern strings for CLI)
GROUP_PATTERNS='[{"pattern":"project","name":"project"},{"pattern":"wal","name":"wal"},{"pattern":"kubernetes","name":"kubernetes"},{"pattern":"^orb","name":"orb"},{"pattern":"^auth","name":"auth"}]'
# GROUP_PATTERNS='[]'
## Same flat schemas as scripts/declarative-export.ts (deduplicated)
FLAT_SCHEMAS="partman,pgboss,openfga,audit,extensions,integrations,orb,stripe"
# FLAT_SCHEMAS="partman"
# ──────────────────────────────────────────────────────────────
# 1. Start platform-db container (used as source for export & apply target)
# ──────────────────────────────────────────────────────────────
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
docker run -d --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=postgres \
  -p "${CONTAINER_PORT}:5432" \
  -v /Users/avallete/Documents/Programming/Supa/platform/worker/db/mnt:/docker-entrypoint-initdb.d \
  platform-db

echo "Waiting for platform-db to be ready..."
until docker exec "$CONTAINER_NAME" pg_isready -U postgres 2>/dev/null; do
  sleep 1
done
# Give the init scripts a moment to finish
sleep 2

# ──────────────────────────────────────────────────────────────
# 1b. Snapshot the clean database as a catalog baseline
# This is only needed if the baseline postgres image have some specificiy (in our case, some specifics SQL ran in init.d script that we don't want to see being part of the declarative schema)
# ──────────────────────────────────────────────────────────────
# echo "Snapshotting clean database as catalog baseline..."
# bun pgdelta catalog-export --target "$DB_URL" --output "$BASELINE_SNAPSHOT"

# ──────────────────────────────────────────────────────────────
# 2. Export declarative schema (snapshot as source, remote as target)
# ──────────────────────────────────────────────────────────────
# The baseline snapshot captures the empty state of the container.
# The target is the remote DB whose schema we want to reproduce.
EXPORT_OPTS=(
  # --source "$BASELINE_SNAPSHOT"
  --target "$TARGET_URL"
  --output "$OUTPUT_DIR"
  --force
  --grouping-mode single-file
  # --grouping-mode subdirectory
  --group-patterns "$GROUP_PATTERNS"
  --flat-schemas "$FLAT_SCHEMAS"
  --format-options "$FORMAT_OPTIONS"
  --diff-focus
  # --dry-run
)

echo "Exporting declarative schema..."
bun pgdelta declarative export "${EXPORT_OPTS[@]}"

# ──────────────────────────────────────────────────────────────
# 3. Apply declarative schema using pg-topo + round-based engine
# ──────────────────────────────────────────────────────────────
# Uses pg-topo for static dependency analysis and topological ordering,
# then applies statements round-by-round to handle any remaining gaps.
echo "Applying declarative schema via declarative apply..."
DEBUG=pg-delta:declarative-apply bun pgdelta declarative apply \
  --path "$OUTPUT_DIR" \
  --target "$DB_URL" \
  # --verbose

# ──────────────────────────────────────────────────────────────
# 4. Verify roundtrip: diff applied DB vs original (expect 0 changes)
# ──────────────────────────────────────────────────────────────
# Use the snapshot as source so verification compares against the same baseline.
echo "Verifying roundtrip: diff applied DB vs original (expect 0 changes)..."
VERIFY_OPTS=(--source "$DB_URL" --target "$TARGET_URL")
if [ -n "${INTEGRATION:-}" ]; then
  VERIFY_OPTS+=(--integration "$INTEGRATION")
fi
VERIFY_OUTPUT=$(bun pgdelta plan "${VERIFY_OPTS[@]}" 2>&1) || true
if echo "$VERIFY_OUTPUT" | grep -q "No changes detected."; then
  echo "Verification passed: 0 changes (declarative schema roundtrip OK)."
else
  echo "$VERIFY_OUTPUT"
  echo ""
  echo "Writing full diff for debugging..."
  bun pgdelta plan "${VERIFY_OPTS[@]}" --format sql
  echo ""
  echo "Verification FAILED: diff reported changes (declarative apply did not match source)."
  exit 1
fi

# ──────────────────────────────────────────────────────────────
# 5. Cleanup
# ──────────────────────────────────────────────────────────────
rm -f "$BASELINE_SNAPSHOT"
docker rm -f "$CONTAINER_NAME" >/dev/null
echo "Container cleaned up."
