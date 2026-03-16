#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NETWORK="pg-delta-e2e-net"
PG_CONTAINER="pg-delta-e2e-db"
E2E_TEMP="$(mktemp -d -t pg-delta-e2e-XXXXXX)"

cleanup() {
  docker rm -f "$PG_CONTAINER" 2>/dev/null || true
  docker network rm "$NETWORK" 2>/dev/null || true
  rm -rf "$E2E_TEMP"
  # Restore node_modules (we removed them for a clean Linux build in Docker)
  if [[ ! -d "$REPO_ROOT/node_modules" ]] && command -v bun >/dev/null 2>&1; then
    echo "=== Restoring node_modules ==="
    (cd "$REPO_ROOT" && bun install)
  fi
}
trap cleanup EXIT

echo "=== Creating Docker network ==="
docker network create "$NETWORK"

echo "=== Starting Postgres ==="
docker run -d \
  --name "$PG_CONTAINER" \
  --network "$NETWORK" \
  -e POSTGRES_PASSWORD=postgres \
  postgres:17-alpine

echo "=== Waiting for Postgres ==="
for i in {1..30}; do
  if docker run --rm --network "$NETWORK" postgres:17-alpine pg_isready -h "$PG_CONTAINER" -U postgres 2>/dev/null; then
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "Postgres failed to become ready"
    exit 1
  fi
  sleep 1
done

echo "=== Building packages ==="
docker run --rm \
  -v "$REPO_ROOT:/app" \
  -w /app \
  oven/bun:latest \
  sh -c "rm -rf node_modules packages/*/node_modules 2>/dev/null; bun install && bun run build"

echo "=== Packing packages ==="
docker run --rm \
  -v "$REPO_ROOT:/app" \
  -w /app/packages/pg-topo \
  node:24-alpine \
  npm pack

docker run --rm \
  -v "$REPO_ROOT:/app" \
  -w /app/packages/pg-delta \
  node:24-alpine \
  npm pack

PG_TOPO_TARBALL="$(ls "$REPO_ROOT"/packages/pg-topo/*.tgz 2>/dev/null | head -1)"
PG_DELTA_TARBALL="$(ls "$REPO_ROOT"/packages/pg-delta/*.tgz 2>/dev/null | head -1)"

if [[ ! -f "$PG_TOPO_TARBALL" || ! -f "$PG_DELTA_TARBALL" ]]; then
  echo "Failed to create tarballs"
  exit 1
fi

echo "=== Validating packed metadata ==="
for tarball in "$PG_TOPO_TARBALL" "$PG_DELTA_TARBALL"; do
  extract_dir="$E2E_TEMP/extract-$(basename "$tarball" .tgz)"
  mkdir -p "$extract_dir"
  tar -xzf "$tarball" -C "$extract_dir"
  if ! docker run --rm \
    -v "$extract_dir:/extract:ro" \
    node:24-alpine \
    node -e "
      const pkg = JSON.parse(require('fs').readFileSync('/extract/package/package.json', 'utf8'));
      for (const field of ['dependencies','peerDependencies','optionalDependencies']) {
        const deps = pkg[field];
        if (!deps || typeof deps !== 'object') continue;
        for (const [k, v] of Object.entries(deps)) {
          if (typeof v === 'string' && v.startsWith('workspace:')) {
            console.error('Packed package contains workspace: protocol in ' + field + '.' + k);
            process.exit(1);
          }
        }
      }
    "; then
    echo "Metadata validation failed"
    exit 1
  fi
done
echo "Metadata OK: no workspace: protocols."

echo "=== Creating temp project ==="
PROJECT_DIR="$E2E_TEMP/project"
mkdir -p "$PROJECT_DIR"
echo '{"name":"pg-delta-e2e","private":true,"type":"module"}' > "$PROJECT_DIR/package.json"

docker run --rm \
  -v "$PROJECT_DIR:/app" \
  -v "$PG_TOPO_TARBALL:/topo.tgz:ro" \
  -v "$PG_DELTA_TARBALL:/delta.tgz:ro" \
  -w /app \
  node:24-alpine \
  sh -c "npm install --silent --no-package-lock /topo.tgz /delta.tgz"

cp "$REPO_ROOT/.github/scripts/fixtures/lib-golden-path.ts" "$PROJECT_DIR/"
cp "$REPO_ROOT/.github/scripts/fixtures/cli-golden-path.ts" "$PROJECT_DIR/"

DATABASE_URL="postgres://postgres:postgres@$PG_CONTAINER:5432/postgres"

run_test() {
  local name="$1"
  local image="$2"
  shift 2
  echo "=== $name ==="
  if ! docker run --rm \
    -v "$PROJECT_DIR:/app" \
    -w /app \
    --network "$NETWORK" \
    -e DATABASE_URL="$DATABASE_URL" \
    "$image" "$@"; then
    echo "$name failed"
    exit 1
  fi
}

echo "=== Node e2e ==="
run_test "Node lib" node:24-alpine node --experimental-strip-types lib-golden-path.ts
run_test "Node cli" node:24-alpine node --experimental-strip-types cli-golden-path.ts

echo "=== Bun e2e ==="
run_test "Bun lib" oven/bun:latest bun run lib-golden-path.ts
run_test "Bun cli" oven/bun:latest bun run cli-golden-path.ts

echo "=== Deno e2e ==="
run_test "Deno lib" denoland/deno:latest deno run --allow-env --allow-read --node-modules-dir=manual lib-golden-path.ts
run_test "Deno cli" denoland/deno:latest deno run --allow-env --allow-read --allow-run --allow-net --node-modules-dir=manual cli-golden-path.ts

echo "=== All e2e tests passed ==="
