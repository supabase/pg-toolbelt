# E2E Pipeline: pg-delta → Supabase CLI → Real Projects

End-to-end tests that build pg-delta, embed it into a locally-built Supabase CLI, and run `db diff --use-pg-delta` against real Supabase projects to catch regressions.

## How it works

1. **Verdaccio** — a local npm registry runs on `localhost:4873`
2. **Build & Publish** — pg-topo and pg-delta are built and published to verdaccio with version `0.0.0-e2e.<git-sha>`
3. **Patch CLI** — the CLI submodule is patched to forward `NPM_CONFIG_REGISTRY` to the edge-runtime container and to use the e2e version of pg-delta
4. **Build CLI** — `go build` produces a patched CLI binary
5. **Run tests** — each `tests/test-*.sh` script starts supabase, runs diffs, and asserts expected output

The edge-runtime container (which runs pg-delta via Deno's `npm:` specifiers) uses `--network host`, so it resolves packages from verdaccio on localhost.

## Prerequisites

- **Docker** (for verdaccio, supabase, edge-runtime, postgres)
- **Go** (to build the CLI)
- **Bun** (to build pg-delta/pg-topo)
- **Node.js** (for npm pack/publish)
- **psql** (for test assertions that modify the database)

## Usage

```bash
# Initialize submodules (first time only)
git submodule update --init --recursive

# Run the full pipeline
bash e2e/scripts/run-tests.sh

# Or run individual steps
bash e2e/scripts/setup-verdaccio.sh
source e2e/scripts/build-and-publish.sh   # exports E2E_VERSION
bash e2e/scripts/patch-cli.sh "$E2E_VERSION"
bash e2e/scripts/build-cli.sh
bash e2e/tests/test-dbdev-clean-diff.sh

# Cleanup
bash e2e/scripts/cleanup.sh
```

## Adding a new test project

1. Add the submodule:
   ```bash
   git submodule add <repo-url> e2e/submodules/<project-name>
   ```
2. Create a test script in `e2e/tests/test-<project>-<scenario>.sh`:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

   PROJECT_DIR="$E2E_DIR/submodules/<project-name>"
   start_supabase "$PROJECT_DIR"
   assert_empty_diff "$PROJECT_DIR" "public"
   stop_supabase "$PROJECT_DIR"
   ```
3. The orchestrator (`run-tests.sh`) auto-discovers `test-*.sh` files.

## Verification

```bash
# Check verdaccio has the packages
curl http://localhost:4873/@supabase/pg-delta

# Check CLI build
e2e/bin/supabase --version
```

## CI

The pipeline runs via `.github/workflows/e2e.yml`:
- **Daily** at 6am UTC (scheduled)
- **On demand** via `workflow_dispatch` (with optional CLI/dbdev ref inputs)
- **NOT** triggered on PRs (too slow)
