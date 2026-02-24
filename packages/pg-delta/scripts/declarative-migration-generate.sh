#!/bin/bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-pgdelta-migration-generate}"
CONTAINER_PORT="${CONTAINER_PORT:-6544}"
ADMIN_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/postgres"
DB_NAME="${DB_NAME:-declarative_migration_test}"
DB_URL="postgres://postgres:postgres@localhost:${CONTAINER_PORT}/${DB_NAME}"
TARGET_URL="${TARGET_URL:-postgres://postgres:postgres@db.platform.orb.local:5432/postgres}"

OUTPUT_DIR="${OUTPUT_DIR:-./declarative-schemas}"
MIGRATION_OUTPUT="${MIGRATION_OUTPUT:-./declarative-migration.sql}"

# Default filter: platform-db exclusions (single-quoted so JSON is preserved when overridden via env).
DEFAULT_FILTER='{"not":{"or":[{"type":"extension","extension":["pgaudit","pg_cron","plv8","pg_stat_statements"]},{"procedureLanguage":["plv8"]}]}}'
FILTER_DSL="${FILTER_DSL:-$DEFAULT_FILTER}"

cleanup() {
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}

trap cleanup EXIT

echo "[1/4] Starting platform-db container..."
rm -f "$MIGRATION_OUTPUT"
docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER_NAME" \
  -e POSTGRES_PASSWORD=postgres \
  -p "${CONTAINER_PORT}:5432" \
  platform-db >/dev/null

echo "Waiting for platform-db to be ready..."
until docker exec "$CONTAINER_NAME" pg_isready -U postgres >/dev/null 2>&1; do
  sleep 1
done
# Give init scripts a moment to finish.
sleep 2

echo "[2/4] Creating clean database '${DB_NAME}'..."
psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS ${DB_NAME}" --quiet >/dev/null 2>&1 || true
psql "$ADMIN_URL" -c "CREATE DATABASE ${DB_NAME} TEMPLATE template0" --quiet >/dev/null

echo "[3/4] Applying declarative schema from '$OUTPUT_DIR' to fresh database..."
DEBUG="${DEBUG:-pg-delta:declarative-apply}" bun pgdelta declarative apply \
  --path "$OUTPUT_DIR" \
  --target "$DB_URL" \
  --no-validate-functions

echo "[4/4] Generating migration SQL (current DB -> declarative target)..."
mkdir -p "$(dirname "$MIGRATION_OUTPUT")"
PLAN_OPTS=(--source "$TARGET_URL" --target "$DB_URL")
if [ -n "${INTEGRATION:-}" ]; then
  PLAN_OPTS+=(--integration "$INTEGRATION")
else
  PLAN_OPTS+=(--filter "$FILTER_DSL")
fi
MIGRATION_SQL="$(bun pgdelta plan "${PLAN_OPTS[@]}" --format sql)"

if [ -z "$MIGRATION_SQL" ] || echo "$MIGRATION_SQL" | grep -q "No changes detected."; then
  echo "No migration SQL generated (no changes detected)."
  : >"$MIGRATION_OUTPUT"
else
  printf "%s\n" "$MIGRATION_SQL"
  printf "%s\n" "$MIGRATION_SQL" >"$MIGRATION_OUTPUT"
  echo ""
  echo "Migration preview written to: $MIGRATION_OUTPUT"
fi
echo "Preview only: migration SQL was not executed."
