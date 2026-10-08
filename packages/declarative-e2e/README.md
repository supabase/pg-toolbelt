# @supabase/declarative-e2e

Private package. Declarative-schema scenarios run through the **Supabase CLI**
against this repo's **working-tree pg-delta**, so engine changes are checked in
the CLI's real workflow before they are released. That workflow uses the
grouped export layout, the Supabase profile, default privileges, the `postgres`
role, the CLI's shadow databases and baselines, and OrioleDB.

## Run

Requires Docker, git, pnpm, and bun.

```sh
cd packages/declarative-e2e
bun run setup-cli          # clone supabase/cli develop, install it with ../pg-delta packed in, write .cli/bin/supabase
bun test tests/            # smoke scenarios on pg 17
DECLARATIVE_SCENARIOS=all bun test tests/
DECLARATIVE_SCENARIO=column-changes bun test tests/
DECLARATIVE_BACKEND=legacy bun test tests/
```

`DECLARATIVE_BACKEND` picks the CLI's local backend:

- `stack` (default): the new stack backend (`[experimental] stack = true`),
  created with `stack prepare --runtime native`, so Postgres runs without
  Docker. `DECLARATIVE_STACK_RUNTIME` overrides the runtime (`docker`,
  `podman`, `auto`). OrioleDB targets are skipped until supabase/cli#6934
  lands.
- `legacy`: the Docker-based backend, including OrioleDB targets.

CI runs the PR smoke set on `stack`, and every scenario nightly on both. The
nightly stack job on `main` rebuilds and saves the CLI's stack cache
(`~/.supabase/cache/stack`: native Postgres and database snapshots); other
runs only restore it, since GitHub shares only `main`'s caches across PRs.

`setup-cli` options:

- `SUPABASE_CLI_REF`: CLI branch or tag, default `develop`.
- `SUPABASE_CLI_DIR`: checkout location, default `.cli/cli`. Use a directory
  `setup-cli` creates. Re-runs force-reset it, so it refuses any existing
  checkout it did not clone, including your own `supabase/cli` clone.
- Re-run `setup-cli` after changing pg-delta. The CLI loads the packed tarball,
  not the live sources.

The tests use `SUPABASE_CLI`, default `.cli/bin/supabase`.

## Scenario format

Each directory under `scenarios/` is one scenario:

```text
<scenario>/
  scenario.json            # required
  remote.sql               # optional: the existing database
  steps/<nn-name>/
    step.json              # required
    schemas/**             # optional: files written over supabase/schemas/
```

`scenario.json` fields (unknown fields are rejected):

- `issue`: link to the bug the scenario reproduces.
- `knownIssue`: `{ "url", "failsAt", "message"?, "target"? }` for an open bug
  that makes this scenario fail.
  - The scenario must fail a check at the step label `failsAt`:
    `bootstrap (converge)`, `<step>`, or `<step> (converge)`.
  - When `message` is set (a string or an array of strings), the failure
    detail must contain each fragment. Converge failures start with `sync did
    not converge (exit N)`, so `(exit 0)` separates a wrong plan from a crash.
  - Any other failure is a real failure, including `reset`, `bootstrap`, and
    unexpected errors.
  - `target` (for example `"pg 17 orioledb"`) limits it to one target; other
    targets must pass.
  - Once the scenario passes, the suite fails with "remove knownIssue". The fix
    PR removes it.
- `tags`: only `smoke` scenarios run by default.
- `pg`: Postgres majors to run, default `[17]`.
- `orioledb`: also run on a pg 17 OrioleDB database (`supabase init
  --use-orioledb`). Never part of the default run; legacy backend only.
- `flags`: extra arguments appended to every `generate` and `sync` call.

Flow:

1. Up to `DECLARATIVE_CONCURRENCY` (default 3) databases start per target,
   each in its own project. They take the target's scenarios from a shared
   queue, longest first, and failures are reported together in scenario
   order. Use `DECLARATIVE_CONCURRENCY=1` for one database and a readable
   log.
2. Per scenario:
   - `supabase/schemas/` and `supabase/migrations/` are emptied;
   - `remote.sql` is written as the first migration;
   - `db reset --local --no-seed` rebuilds the database.
3. With `remote.sql`, `db schema declarative generate --local --overwrite`
   bootstraps `supabase/schemas/`, then the converge check runs.
4. Each step, in sorted order:
   - removes its `delete` paths;
   - overlays its `schemas/`;
   - runs its command and checks `step.json`;
   - runs the converge check. A sync step expecting `migration: "none"`
     instead requires "No schema changes found" in its own output.

The converge check runs `sync --no-apply`. It requires exit 0, "No schema
changes found", and no new migration file.

`step.json` fields (unknown fields are rejected):

- `command`: `"sync"` (default, `sync --apply --name <step>`) or
  `"generate"`, which re-exports with `generate --local --overwrite`. A
  `generate` step requires `migration: "none"` and rejects
  `contains`/`notContains`/`destructive`.
- `delete`: paths under `supabase/schemas/` removed before the command; each
  must exist.
- `migration`: `"none"` or `"some"` (at least one new migration file).
- `contains` / `notContains`: SQL fragments matched against the step's new
  migrations. Both sides are lowercased, double quotes are removed, and
  whitespace is collapsed.
- `destructive`: whether the output must carry the "Found destructive changes"
  warning, default `false`.
- `unchanged`: paths under `supabase/schemas/` that must be byte-identical
  before and after the step.
- `rowCounts`: `"schema.table": n`, the exact row count after the step, read
  with `db query --local`.

Observed `_custom/` contract: its SQL is loaded into the shadow only and is not
migrated to the target, and `generate` never rewrites it.

## When to add a scenario

- A declarative-schema bug reported through the CLI. It ships alongside the
  engine regression test. If the fix is not in this PR, mark it `knownIssue`.
- A change to export, load, plan files, ACLs or default privileges, ordering,
  or the Supabase profile that the existing scenarios do not exercise.

Keep each scenario small. Name steps after what the user does (`02-add-grant`).
