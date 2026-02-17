#!/bin/bash
set -e

CONTAINER_NAME="pgdelta-dogfooding"
CONTAINER_PORT=6544
ADMIN_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/postgres"
DB_NAME="declarative_test"
DB_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/${DB_NAME}"

TARGET_URL="${TARGET_URL:-postgres://postgres:postgres@db.platform.orb.local:5432/postgres}"
OUTPUT_DIR="${OUTPUT_DIR:-./declarative-schemas}"
# Default filter: platform-db exclusions (single-quoted so JSON is preserved when overridden via env).
DEFAULT_FILTER='{"not":{"or":[{"type":"extension","extension":["pgaudit","pg_cron","plv8","pg_stat_statements"]},{"procedureLanguage":["plv8"]}]}}'
FILTER_DSL="${FILTER_DSL:-$DEFAULT_FILTER}"

# Same format options as scripts/declarative-export.ts
FORMAT_OPTIONS='{"keywordCase":"lower","maxWidth":180,"indent":4}'
# Same group patterns as scripts/declarative-export.ts (pattern strings for CLI)
GROUP_PATTERNS='[{"pattern":"project","name":"project"},{"pattern":"wal","name":"wal"},{"pattern":"kubernetes","name":"kubernetes"},{"pattern":"^orb","name":"orb"},{"pattern":"^auth","name":"auth"},{"pattern":"^custom","name":"custom"},{"pattern":"^credit","name":"credit"},{"pattern":"user","name":"user"},{"pattern":"^oauth","name":"oauth"},{"pattern":"^can","name":"can"},{"pattern":"billing","name":"billing"},{"pattern":"organization","name":"organization"},{"pattern":"keys$","name":"keys"}]'
# Same flat schemas as scripts/declarative-export.ts (deduplicated)
FLAT_SCHEMAS="partman,pgboss,openfga,audit,extensions,integrations,orb,stripe"

# ──────────────────────────────────────────────────────────────
# 1. Start platform-db container (used as source for export & apply target)
# ──────────────────────────────────────────────────────────────
docker rm -f "$CONTAINER_NAME" 2>/dev/null || true
docker run -d --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=postgres \
  -p "${CONTAINER_PORT}:5432" \
  platform-db

echo "Waiting for platform-db to be ready..."
until docker exec "$CONTAINER_NAME" pg_isready -U postgres 2>/dev/null; do
  sleep 1
done
# Give the init scripts a moment to finish
sleep 2

# Create a fresh, empty database for the declarative schema.
# We use platform-db (not vanilla postgres) because it has shared libraries
# for extensions like pg_partman, pgtap, etc.
echo "Creating clean database '${DB_NAME}'..."
psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS ${DB_NAME}" --quiet 2>/dev/null || true
psql "$ADMIN_URL" -c "CREATE DATABASE ${DB_NAME} TEMPLATE template0" --quiet

# ──────────────────────────────────────────────────────────────
# 2. Export declarative schema (container as source, remote as target)
# ──────────────────────────────────────────────────────────────
# The container is the source (empty baseline) where we will apply the schema.
# The target is the remote DB whose schema we want to reproduce.
EXPORT_OPTS=(
  --source "$DB_URL"
  --target "$TARGET_URL"
  --output "$OUTPUT_DIR"
  --force
  --grouping-mode single-file
  --group-patterns "$GROUP_PATTERNS"
  --flat-schemas "$FLAT_SCHEMAS"
  --format-options "$FORMAT_OPTIONS"
  --filter "$FILTER_DSL"
)

echo "Exporting declarative schema..."
pnpm pgdelta declarative export "${EXPORT_OPTS[@]}"

# ──────────────────────────────────────────────────────────────
# 3. Apply declarative schema using pg-topo + round-based engine
# ──────────────────────────────────────────────────────────────
# Uses pg-topo for static dependency analysis and topological ordering,
# then applies statements round-by-round to handle any remaining gaps.
echo "Applying declarative schema via declarative apply..."
pnpm pgdelta declarative apply \
  --path "$OUTPUT_DIR" \
  --target "$DB_URL" \
  --verbose

# ──────────────────────────────────────────────────────────────
# 4. Verify roundtrip: diff applied DB vs original (expect 0 changes)
# ──────────────────────────────────────────────────────────────
# Same filter/integration as export.
echo "Verifying roundtrip: diff applied DB vs original (expect 0 changes)..."
VERIFY_OPTS=(--source "$DB_URL" --target "$TARGET_URL")
if [ -n "${INTEGRATION:-}" ]; then
  VERIFY_OPTS+=(--integration "$INTEGRATION")
else
  VERIFY_OPTS+=(--filter "$FILTER_DSL")
fi
VERIFY_OUTPUT=$(pnpm pgdelta plan "${VERIFY_OPTS[@]}" 2>&1) || true
if echo "$VERIFY_OUTPUT" | grep -q "No changes detected."; then
  echo "Verification passed: 0 changes (declarative schema roundtrip OK)."
else
  echo "$VERIFY_OUTPUT"
  echo ""
  echo "Writing full diff for debugging..."
  pnpm pgdelta plan "${VERIFY_OPTS[@]}" --format sql
  echo ""
  echo "Verification FAILED: diff reported changes (declarative apply did not match source)."
  exit 1
fi

# ──────────────────────────────────────────────────────────────
# 5. Cleanup
# ──────────────────────────────────────────────────────────────
docker rm -f "$CONTAINER_NAME" >/dev/null
echo "Container cleaned up."
