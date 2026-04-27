# Supabase project integration fixtures

This document describes the **Supabase project fixture** layout and tests added to replace the single-file `dbdev-roundtrip.test.ts` integration.

## Why this exists

The previous pattern bundled the **dbdev** migration SQL under `fixtures/dbdev-migrations/` and encoded the full declarative roundtrip in one long test. The new design:

- **Scales to more real-world projects** — each project is a directory with a `project.ts` manifest and a `migrations/` tree.
- **Separates concerns** — discovery (`supabase-project-fixture.ts`), scenario runners (`supabase-project-runners.ts`), and failure reporting (`supabase-project-report.ts`) are reusable.
- **Supports multiple validation modes** — not only “export then apply and diff to zero,” but also stepwise **smoke** tests over migration history.

## Directory layout

```
tests/integration/
  fixtures/supabase-projects/
    <project-id>/
      project.ts          # default export: SupabaseProjectFixture
      migrations/         # ordered *.sql files (lexicographic name order)
        ...
  supabase-project-fixture.ts
  supabase-project-runners.ts
  supabase-project-report.ts
  supabase-project-*.test.ts
```

**Current projects:** `dbdev` (Supabase Postgres 15), migrated from the old `dbdev-migrations` path without changing SQL contents (paths-only rename).

## Fixture manifest (`project.ts`)

A fixture is created with `defineSupabaseProjectFixture({ ... })` and exported as `default`. Important fields:

| Field | Purpose |
|--------|--------|
| `id` | Stable id used in `PGDELTA_SUPABASE_PROJECT` and artifact names. |
| `supabasePostgresVersion` | Which Supabase image line to use (must be listed in `SUPABASE_POSTGRES_VERSIONS` in `tests/constants.ts`). |
| `integration` | e.g. the shared `supabase` integration (filter + serialize DSL). |
| `migrationsDir` | URL or path to the `migrations/` folder. |
| `setRole` | Optional per-connection `SET ROLE` (dbdev uses `postgres` to mirror CLI behavior around default privileges for `createPlan` / export / apply). The generated `*_fullstack_container_init.sql` is replayed **before** any `SET ROLE`, using a bootstrap connection (so `auth` and service schemas can be altered). Fixture migration files then run on the same pools that perform planning (with `SET ROLE` when this field is set), matching the old `dbdev-roundtrip` behavior for schema ownership. |
| `skipDefaultPrivilegeSubtraction` | Passed to `createPlan` (dbdev sets `true` for the known GRANT / `ALTER DEFAULT PRIVILEGES` interaction). |
| `validateFunctionBodies` | Declarative apply: whether to validate function bodies (default false for Supabase projects that reference `auth` and friends). |
| `candidateRegressionNote` | Shown in failure `report.md` — guidance for turning a failure into a smaller regression test. |
| `scenarios` | Per-scenario options (see below). |

### Scenarios

Each scenario name maps to optional:

- `include` — filter migration **filenames** (e.g. dbdev **declarative** only runs `20220117*` to keep the test fast and avoid later data-only migrations that break across image versions).
- `onApplyError` — `fail` (default) or `skip` when applying migrations to the branch database (useful when some files are expected to fail in CI until images catch up).
- `skipAdjacentPlanApply` — **adjacent** only. If the predicate returns `true` for a migration file, the runner still applies that migration to branch and main, but **skips** the pairwise `createPlan` / apply / zero-diff check for that step. Use when the real SQL uses a **DEFAULT → DML backfill → DROP DEFAULT** (or other data path) so the final catalog looks like a plain `ADD NOT NULL` with no default; a schema-only plan cannot apply safely to non-empty tables. The dbdev migration `20231205051816_add_default_version.sql` is an example and is listed in that fixture’s `project.ts`.

**Progressive scope (dbdev):** The progressive runner keeps the **branch** on the fully migrated set while **main** advances one migration at a time, then `createPlan`/`apply` must reconcile main to *that* branch. Comparing a half-migrated `main` to a branch that already includes *later* migrations (e.g. multi-statement `ADD COLUMN` + backfill in one migration file) is not, in general, a single plan that applies cleanly, so the dbdev fixture **limits the progressive `include` filter** to the same `20220117*` prefix as the declarative scenario. **Adjacent** applies one migration at a time, so it does not need a filename prefix cap; use `skipAdjacentPlanApply` for individual files whose author migration cannot be approximated from catalog state alone.

Three scenario **names** are built in:

1. **`declarative`** — Full **declarative roundtrip**: base Supabase init on both sides, apply scenario migrations to **branch** only, `createPlan` → `exportDeclarativeSchema` → `applyDeclarativeSchema` on **main**, then assert filtered diff is empty. Entry: `supabase-project-declarative.test.ts`.

2. **`progressive`** — After all branch migrations apply, **advance main one migration at a time** (step 0 = empty main). At each step, `createPlan`, optionally apply plan in a transaction, and assert no remaining filtered changes. Entry: `supabase-project-progressive.test.ts`.

3. **`adjacent`** — For each migration in order, apply it on **branch**, then plan/apply on **main** and catch up **main** with the same migration after the check (pairwise “adjacent” state). Entry: `supabase-project-adjacent.test.ts`.

## Discovery and env vars

`discoverSupabaseProjectFixtures()` scans `fixtures/supabase-projects/*/` for `project.ts` and returns every fixture whose `supabasePostgresVersion` is in the current test matrix.

| Variable | Effect |
|----------|--------|
| `PGDELTA_SUPABASE_PROJECT` | If set, only the fixture with matching `id` is loaded (faster local runs). |
| `PGDELTA_SUPABASE_SMOKE_STEP_FROM` / `PGDELTA_SUPABASE_SMOKE_STEP_TO` | Limit which steps run in **progressive** / **adjacent** smoke (0-based; inclusive range). |
| `PGDELTA_SUPABASE_SMOKE_SKIP_APPLY` | `1` = only plan, do not apply statements in smoke scenarios. |
| `PGDELTA_SUPABASE_SMOKE_REPORT_DIR` | Override base directory for failure artifacts (default under `packages/pg-delta/test-results/supabase-smoke/`). |

Repro commands for a failed step are built in `buildSupabaseSmokeReproCommand()` (see `supabase-project-runners.test.ts`).

## Failure artifacts

On failure, `writeSupabaseSmokeFailureArtifacts()` writes a directory with:

- `report.md` — human-readable summary, error, repro command, optional plan/remaining SQL, candidate regression note.
- `metadata.json` — structured fields for tooling.
- Optional `plan.sql`, `remaining.sql`, `source-catalog.json`, `target-catalog.json`.

`packages/pg-delta/test-results/` is gitignored (see root `.gitignore`).

## Tests (file map)

| File | Role |
|------|------|
| `supabase-project-fixture.test.ts` | Asserts dbdev layout and manifest basics. |
| `supabase-project-declarative.test.ts` | Declarative roundtrip for all discovered fixtures. |
| `supabase-project-progressive.test.ts` | Progressive smoke. |
| `supabase-project-adjacent.test.ts` | Adjacent smoke. |
| `supabase-project-runners.test.ts` | Unit tests for repro command and step range validation. |
| `supabase-project-report.test.ts` | Unit test for artifact writer. |

## Adding a new project

1. Create `fixtures/supabase-projects/<id>/migrations/` with SQL files.
2. Add `project.ts` exporting `defineSupabaseProjectFixture({ ... })` with the right `supabasePostgresVersion`, `integration`, and `scenarios`.
3. Ensure the version is in `SUPABASE_POSTGRES_VERSIONS` if the tests should run in CI.
4. Run a focused check, e.g. `PGDELTA_TEST_POSTGRES_VERSIONS=<ver> PGDELTA_SUPABASE_PROJECT=<id> bun run test tests/integration/supabase-project-declarative.test.ts`.

## Relationship to `applySupabaseBaseInit`

The runners start `SupabasePostgreSqlContainer` and use the same **base-init** replay as other Supabase integration tests (via the shared test utilities / container setup). Any new project that depends on stock Supabase objects must keep that bootstrap path consistent with `tests/utils.ts` and the generated `supabase-base-init` fixtures when images change.
