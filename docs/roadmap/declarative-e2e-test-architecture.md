# Declarative-schema scenario tests (Supabase CLI)

- **Status**: In progress (2026-10-06).
- **Lives in**: `packages/declarative-e2e` (runner, scenarios, format README),
  run by `.github/workflows/declarative-e2e.yml`. A first Effect-based copy also
  exists on the `supabase/cli` branch `avallete/declarative-scenarios-e2e`; the
  decision to keep or drop it is open.

## Why

pg-delta's corpus proves plans SQL-state to SQL-state on stock Postgres. The
CLI's declarative workflow adds the grouped export layout, the Supabase profile,
Supabase default privileges, the non-superuser `postgres` role, and its own
shadow and baseline handling. Regressions that only appear in that combination
reach users without any failing test. The #475 regression, fixed in #512, was
one: an unchanged `generate` → `sync` revoked a column grant.

## How it works

```mermaid
flowchart TD
  P["setup-cli: clone supabase/cli develop,<br/>install workspace pg-delta tarball"] --> S
  S["db start (one DB per target)"] --> R["per scenario: db reset<br/>with remote.sql as first migration"]
  R --> B["generate --local --overwrite<br/>(when remote.sql exists)"]
  B --> C1{"sync --no-apply:<br/>No schema changes found?"}
  C1 --> L["each step: overlay files,<br/>sync --apply or generate"]
  L --> E{"step.json checks:<br/>migration, fragments,<br/>destructive warning, rows"}
  E --> C2{"re-sync converges?"}
  C2 --> L
```

- It drives the Supabase CLI from source (`develop`) with this checkout's pg-delta,
  so a pg-delta PR is checked in the CLI's real workflow before release. Shadows,
  baselines, export layout, and formatting are the CLI's own code.
- Each scenario is a folder: `scenario.json`, an optional `remote.sql`, and
  `steps/<nn-name>/` with `step.json` plus optional `schemas/**` overlays.
- Checks are properties, not golden SQL: no-change re-sync, short migration
  fragments, the destructive-warning flag, unchanged files, and row counts.
- `knownIssue` pins an open bug to the step where it fails (optionally a
  single target), and the suite fails once the bug is fixed.
- Targets: Postgres majors (`pg`), plus `orioledb: true` for a PG17 OrioleDB
  database.
- Default per-PR run: the `smoke` scenarios on PG17. Use
  `DECLARATIVE_SCENARIOS=all` for everything, or `DECLARATIVE_SCENARIO=<name>`
  for one scenario.

## Coverage today

- **Workflows:**
  - create from scratch;
  - file-layout changes (move, split, reorder, delete);
  - table and column grants lifecycle;
  - functions and triggers;
  - RLS policies;
  - column changes with data;
  - views on tables;
  - enum values;
  - the `_custom/` escape hatch;
  - the Supabase starter app (`auth.users` trigger, RLS) on PG15 and PG17.
- **Regressions guarded:**
  - #512, column grants under default privileges.
  - #513, OrioleDB. Before it, the export re-created the preinstalled `orioledb`
    extension, so the first sync failed with `extension "orioledb" already
    exists`.
- **Known issues:**
  - #510, a trigger `WHEN` with a 3+ column row comparison never converges.
  - #517 (fix in #520): `REVOKE ALL ON SCHEMA public FROM anon, PUBLIC` is
    lost by the export, so the unchanged re-sync grants `USAGE` back.

## Rules

- A declarative-schema bug reported through the CLI gets a pg-delta regression
  test **and** a CLI scenario. See "Declarative schemas (Supabase CLI)" in
  `.github/agents/pg-toolbelt.md`.
- pg-delta changes to export, load, plan files, ACLs, ordering, or the Supabase
  profile run `DECLARATIVE_SCENARIOS=all` locally before they are called done.
  CI runs the smoke set on PRs and everything nightly.

## Open items

- CLI-side changes (adapter, shadows, baselines) are not gated: `supabase/cli` CI
  could check out `packages/declarative-e2e` and run it against its own build.
- The job tracks CLI `develop`, so a CLI regression can turn it red without any
  pg-delta change. It is not a required check.
- `_custom/` SQL is loaded into the shadow only and never migrated to the
  target. Decide whether that is the intended contract.
- Rewriting an exported table file without its GRANT lines revokes the
  platform grants (`anon`, `authenticated`, `service_role`). This may need a DX
  warning.
