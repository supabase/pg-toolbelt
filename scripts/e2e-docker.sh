#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_ID="$(date +%s)-$$"
NETWORK="pg-delta-e2e-net-$RUN_ID"
PG_CONTAINER="pg-delta-e2e-db-$RUN_ID"
E2E_TEMP="$(mktemp -d -t pg-delta-e2e-XXXXXX)"
SOURCE_DIR="$E2E_TEMP/source"
PACK_DIR="$E2E_TEMP/pack"
PROJECT_DIR="$E2E_TEMP/project"

cleanup() {
  docker rm -f "$PG_CONTAINER" 2>/dev/null || true
  docker network rm "$NETWORK" 2>/dev/null || true
  rm -rf "$E2E_TEMP"
}
trap cleanup EXIT

copy_source_checkout() {
  echo "=== Copying checkout into temp workspace ==="
  mkdir -p "$SOURCE_DIR" "$PACK_DIR" "$PROJECT_DIR"
  rsync -a \
    --exclude '.git/' \
    --exclude 'node_modules/' \
    --exclude 'packages/*/node_modules/' \
    --exclude 'packages/*/dist/' \
    --exclude '*.tgz' \
    "$REPO_ROOT/" "$SOURCE_DIR/"
}

pack_package() {
  local package_name="$1"
  local package_dir="$2"
  local pack_json_path="$PACK_DIR/$package_name-pack.json"
  local filename

  docker run --rm \
    -v "$SOURCE_DIR:/app" \
    -v "$PACK_DIR:/pack" \
    -w "/app/$package_dir" \
    oven/bun:latest \
    sh -lc "npm pack --json --pack-destination /pack" > "$pack_json_path"

  filename="$(
    docker run --rm \
      -v "$PACK_DIR:/pack:ro" \
      node:24-alpine \
      node -e '
        const fs = require("node:fs");
        const pack = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        const filename = pack?.[0]?.filename;
        if (typeof filename !== "string" || filename.length === 0) {
          throw new Error("npm pack did not return a filename");
        }
        process.stdout.write(filename);
      ' "/pack/$package_name-pack.json"
  )"

  echo "$PACK_DIR/$filename"
}

echo "=== Creating Docker network ==="
docker network create "$NETWORK" >/dev/null

echo "=== Starting Postgres ==="
docker run -d \
  --name "$PG_CONTAINER" \
  --network "$NETWORK" \
  -e POSTGRES_PASSWORD=postgres \
  postgres:17-alpine >/dev/null

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

copy_source_checkout

echo "=== Building packages ==="
docker run --rm \
  -v "$SOURCE_DIR:/app" \
  -w /app \
  oven/bun:latest \
  sh -lc "bun install && bun run build"

echo "=== Packing packages ==="
PG_TOPO_TARBALL="$(pack_package "pg-topo" "packages/pg-topo")"
PG_DELTA_TARBALL="$(pack_package "pg-delta" "packages/pg-delta")"

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

  case "$(basename "$tarball")" in
    supabase-pg-topo-*.tgz)
      required_files=(
        "$extract_dir/package/dist/index.js"
        "$extract_dir/package/dist/node.js"
        "$extract_dir/package/dist/bun.js"
      )
      ;;
    supabase-pg-delta-*.tgz)
      required_files=(
        "$extract_dir/package/dist/index.js"
        "$extract_dir/package/dist/node.js"
        "$extract_dir/package/dist/bun.js"
        "$extract_dir/package/dist/cli/bin/cli.js"
      )
      ;;
    *)
      required_files=()
      ;;
  esac

  for required_file in "${required_files[@]}"; do
    if [[ ! -f "$required_file" ]]; then
      echo "Packed package is missing expected artifact: $required_file"
      exit 1
    fi
  done
done
echo "Metadata OK: no workspace: protocols."

echo "=== Creating temp project ==="
echo '{"name":"pg-delta-e2e","private":true,"type":"module"}' > "$PROJECT_DIR/package.json"

docker run --rm \
  -v "$PROJECT_DIR:/app" \
  -v "$PG_TOPO_TARBALL:/topo.tgz:ro" \
  -v "$PG_DELTA_TARBALL:/delta.tgz:ro" \
  -w /app \
  node:24-alpine \
  sh -c "npm install --silent --no-package-lock /topo.tgz /delta.tgz"

cp "$SOURCE_DIR/.github/scripts/fixtures/lib-golden-path.ts" "$PROJECT_DIR/"
cp "$SOURCE_DIR/.github/scripts/fixtures/cli-golden-path.ts" "$PROJECT_DIR/"

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
