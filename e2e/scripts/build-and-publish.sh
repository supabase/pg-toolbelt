#!/usr/bin/env bash
# Build pg-topo and pg-delta, then publish to local verdaccio registry.
# Exports E2E_VERSION for downstream scripts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REGISTRY="${NPM_CONFIG_REGISTRY:-http://localhost:4873}"

# Generate a unique version based on git sha
GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
E2E_VERSION="0.0.0-e2e.${GIT_SHA}"
export E2E_VERSION

echo "=== Building packages ==="
cd "$REPO_ROOT"
bun run build

echo "=== Publishing pg-topo@${E2E_VERSION} ==="
TOPO_DIR="$REPO_ROOT/packages/pg-topo"
cd "$TOPO_DIR"

# Set version and pack
npm version "$E2E_VERSION" --no-git-tag-version --allow-same-version
npm pack

TOPO_TGZ="$(ls supabase-pg-topo-*.tgz)"
npm publish "$TOPO_TGZ" --registry "$REGISTRY" --no-git-tag-version
rm -f "$TOPO_TGZ"

echo "=== Publishing pg-delta@${E2E_VERSION} ==="
DELTA_DIR="$REPO_ROOT/packages/pg-delta"
cd "$DELTA_DIR"

# Set version
npm version "$E2E_VERSION" --no-git-tag-version --allow-same-version

# Replace workspace:* dependency on pg-topo with the concrete e2e version
# Use node to do this reliably
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  if (pkg.dependencies && pkg.dependencies['@supabase/pg-topo']) {
    pkg.dependencies['@supabase/pg-topo'] = '${E2E_VERSION}';
  }
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

npm pack

DELTA_TGZ="$(ls supabase-pg-delta-*.tgz)"
npm publish "$DELTA_TGZ" --registry "$REGISTRY" --no-git-tag-version
rm -f "$DELTA_TGZ"

echo "=== Published @supabase/pg-topo@${E2E_VERSION} and @supabase/pg-delta@${E2E_VERSION} ==="

# Restore package.json files (undo version + dep changes)
cd "$REPO_ROOT"
git checkout -- packages/pg-topo/package.json packages/pg-delta/package.json
