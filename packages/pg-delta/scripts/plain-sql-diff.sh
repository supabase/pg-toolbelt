#!/bin/bash
set -e

# Roundtrip test using a single plain SQL diff (no declarative export).
# 1. Create shadow DB via Docker
# 2. Extract diff (empty shadow → target) as one SQL file
# 3. Apply that SQL to the shadow
# 4. Rediff shadow → target; result should be empty
#
# Usage: TARGET_URL=postgres://... ./scripts/plain-sql-diff.sh

CONTAINER_NAME="pgdelta-plain-sql"
CONTAINER_PORT=6544
ADMIN_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/postgres"
DB_NAME="plain_sql_test"
SHADOW_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/${DB_NAME}"
TARGET_URL="${TARGET_URL:-postgres://postgres:postgres@db.platform.orb.local:5432/postgres}"
MIGRATION_FILE="./declarative-schemas/plain-sql-diff-migration.sql"

# Same filter as declarative-export (exclude platform-db–specific extensions).
FILTER_DSL='{"not":{"or":[{"type":"extension","extension":["pgaudit","pg_cron","plv8","pg_stat_statements"]},{"procedureLanguage":["plv8"]}]}}'

# ──────────────────────────────────────────────────────────────
# 1. Create shadow DB via Docker
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
sleep 2

echo "Creating clean database '${DB_NAME}'..."
psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS ${DB_NAME}" --quiet 2>/dev/null || true
psql "$ADMIN_URL" -c "CREATE DATABASE ${DB_NAME} TEMPLATE template0" --quiet

# ──────────────────────────────────────────────────────────────
# 2. Extract diff (shadow empty → target) as plain SQL
# ──────────────────────────────────────────────────────────────
echo "Extracting diff (shadow → target) as SQL..."
bun pgdelta plan --source "$SHADOW_URL" --target "$TARGET_URL" --filter "$FILTER_DSL" --format sql --sql-format --sql-format-options '{"keywordCase":"lower","maxWidth":180, "indent":2, "commaStyle":"trailing", "alignColumns":true, "alignKeyValues":true, "preserveRoutineBodies":true, "preserveViewBodies":true, "preserveRuleBodies":true}' --output "$MIGRATION_FILE"

# ──────────────────────────────────────────────────────────────
# 3. Apply the diff to the shadow
# ──────────────────────────────────────────────────────────────
echo "Applying migration to shadow..."
psql "$SHADOW_URL" -f "$MIGRATION_FILE" -v ON_ERROR_STOP=1 --quiet

echo "Migration applied successfully."

# ──────────────────────────────────────────────────────────────
# 4. Rediff shadow → target; result should be empty
# ──────────────────────────────────────────────────────────────
echo "Verifying roundtrip: diff shadow vs target (expect 0 changes)..."
VERIFY_OUTPUT=$(bun pgdelta plan --source "$SHADOW_URL" --target "$TARGET_URL" --filter "$FILTER_DSL" 2>&1) || true
if echo "$VERIFY_OUTPUT" | grep -q "No changes detected."; then
  echo "Verification passed: 0 changes (plain SQL roundtrip OK)."
else
  echo "$VERIFY_OUTPUT"
  echo ""
  echo "Writing full diff for debugging..."
  bun pgdelta plan --source "$SHADOW_URL" --target "$TARGET_URL" --filter "$FILTER_DSL" --format sql
  echo ""
  echo "Verification FAILED: diff reported changes (plain SQL apply did not match target)."
  exit 1
fi

# ──────────────────────────────────────────────────────────────
# 5. Cleanup
# ──────────────────────────────────────────────────────────────
docker rm -f "$CONTAINER_NAME" >/dev/null
echo "Container left running. Migration file: $MIGRATION_FILE"
