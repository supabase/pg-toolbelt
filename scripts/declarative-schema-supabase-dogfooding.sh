#!/bin/bash
set -e

CONTAINER_NAME="pgdelta-dogfooding"
CONTAINER_PORT=6543
ADMIN_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/postgres"
DB_NAME="declarative_test"
DB_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/${DB_NAME}"

# ──────────────────────────────────────────────────────────────
# 1. Export declarative schema from source
# ──────────────────────────────────────────────────────────────
rm -rf ./declarative-schemas/*
export SOURCE_URL="postgres://postgres:postgres@db-empty.platform.orb.local:5432/postgres"
export TARGET_URL="postgres://postgres:postgres@db.platform.orb.local:5432/postgres"
pnpm dlx tsx scripts/declarative-export.ts

# ──────────────────────────────────────────────────────────────
# 2. Start platform-db container
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
# 3. Apply SQL files in order (single pass)
# ──────────────────────────────────────────────────────────────
echo "Applying declarative schema files..."
FAILED=0
node -e "
const order = JSON.parse(require('fs').readFileSync('./declarative-schemas/order.json', 'utf8'));
order.forEach(f => console.log(f));
" | while read -r file; do
  if ! psql "$DB_URL" \
    -f "./declarative-schemas/$file" \
    -v ON_ERROR_STOP=1 \
    --quiet 2>&1; then
    echo ""
    echo "FAILED on file: $file"
    exit 1
  fi
done

echo ""
echo "All files applied successfully."

# ──────────────────────────────────────────────────────────────
# 4. Verify roundtrip: diff applied DB vs original (expect 0 changes)
# ──────────────────────────────────────────────────────────────
# Same filter as declarative-export (exclude platform-db–specific extensions).
FILTER_DSL='{"not":{"or":[{"type":"extension","extension":["pgaudit","pg_cron","plv8","pg_stat_statements"]},{"procedureLanguage":["plv8"]}]}}'
echo "Verifying roundtrip: diff applied DB vs original (expect 0 changes)..."
VERIFY_OUTPUT=$(pnpm pgdelta plan --source "$DB_URL" --target "$TARGET_URL" --filter "$FILTER_DSL" 2>&1) || true
if echo "$VERIFY_OUTPUT" | grep -q "No changes detected."; then
  echo "Verification passed: 0 changes (declarative schema roundtrip OK)."
else
  echo "$VERIFY_OUTPUT"
  echo ""
  echo "Writing full diff for debugging..."
  pnpm pgdelta plan --source "$DB_URL" --target "$TARGET_URL" --filter "$FILTER_DSL" --format sql
  echo ""
  echo "Verification FAILED: diff reported changes (declarative apply did not match source)."
  exit 1
fi

# ──────────────────────────────────────────────────────────────
# 5. Cleanup
# ──────────────────────────────────────────────────────────────
docker rm -f "$CONTAINER_NAME" >/dev/null
echo "Container cleaned up."
