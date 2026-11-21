# owner-lab

The measuring stick for "make pg-delta plans applicable by a non-superuser
applier". It runs a scenario (a.sql -> b.sql) end to end as a NON-superuser
applier (`lab_applier`, CREATEROLE NOSUPERUSER) on real Postgres, judges the
result and compares raw catalogs by name (owners, ACLs, role attributes,
`pg_auth_members`, default ACLs).

    cd packages/pg-delta
    export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock
    bun tests/owner-lab/lab.ts --image postgres:17-alpine --suite --direction both
    bun tests/owner-lab/lab.ts --image postgres:17-alpine tests/owner-lab/scenarios/<name>
    bun tests/owner-lab/lab.ts --image postgres:17-alpine --corpus [--filter <substr>]

The lab imports nothing that only exists on the applier-authorization PoC
(`CapabilityError`, `blockers`, ...): those are detected structurally at run
time (`plan.blockers?.length`, `error.name` / `error.code`), so the same files
run on a base tree. `verdict.ts` holds the pure parts (ideal resolution,
verdicts, baseline key, statement diff).

## Flags

| flag | meaning |
| --- | --- |
| `--image` | Postgres image (default `$PGDELTA_TEST_IMAGE`, else `postgres:17-alpine`) |
| `--suite` | every scenario dir under `scenarios/`, `adversarial/`, `generated/`, and `supabase/` only with `--supabase` (a dir holding `a.sql` is a scenario, others are recursed) |
| `--all` | `scenarios/` only; `--corpus [--filter s]` adds `../../corpus` dirs; positional dirs also work |
| `--shard i/n` | 1-based; takes every n-th dir of the sorted list. Run shards as parallel processes, each with its OWN `--json` / `--record-baseline` file (both are truncated at start) and `cat` them afterwards |
| `--direction forward\|reverse\|both` | default `forward` |
| `--applier createrole\|superuser` | superuser: nothing can be refused, so `ideal` is always `converge` |
| `--login direct\|stepdown` | `stepdown`: every applier connection logs in as `lab_login` (LOGIN NOSUPERUSER NOINHERIT, granted the applier `WITH INHERIT FALSE, SET TRUE` on PG16+, plain GRANT on <=15) and runs `SET SESSION ROLE <applier>` on connect, like the Supabase CLI. Scenario setup (a.sql/b.sql) still runs over DIRECT applier connections, because generated scenarios use `session_user` / `SET ROLE`, which mean something else behind a login role (`--stepdown-setup` steps those down too: ~300 of 1106 runs then end SETUP_FAIL). Extract, probe, plan and apply always step down. Ignored with `--applier superuser` |
| `--via apply\|script` | `script`: render with `renderApplyScript` and send the text as ONE simple-protocol `client.query`. A render refusal is BLOCKED. A failed script is followed by `ROLLBACK` so the session state can be read |
| `--record-baseline f.jsonl` / `--compare-baseline f.jsonl` | see Baselines |
| `--json f` | one JSON line per run: everything (outcome, verdict, flags, tags, ideal, segments, plan statements, role before/after, timings) |
| `--verbose`, `--supabase`, `--no-profile` | see below |

## Scenario directory

`a.sql`, `b.sql` (required, run as the applier); optional `pre-a/pre-b.sql` and
`post-a/post-b.sql` (run as the cluster superuser before / after), optional
`seed-a.sql` / `seed-b.sql` (superuser INSERTs against the SOURCE database of
the run: `seed-a` forward, `seed-b` reverse), `meta.json`:

- `minVersion`, `maxVersion`, `applierInherit`, `dbOwner`, `executeAs`, `notes`,
  `tags: string[]` (copied to the JSON), corpus `renames` and `settleDesired`,
  `planParams` (passed to `plan()` as `params`).
- `ideal`: `"converge"` (default) or `"refuse"`, or `{ "forward": ..., "reverse": ... }`.
  `idealByMajor`: `{ "<=15": ..., ">=16": ... }` (same value shapes, keys accept
  `<= >= < > =`), overrides `ideal` when the server major matches. `expect` is an
  alias of `ideal`.

## Oracles

Outcomes: OK, SETUP_FAIL, PLAN_THROW, BLOCKED (plan carries blockers, or the
script renderer refused), REFUSED_IDENTITY (apply refused a plan bound to another
applier), APPLY_FAIL, FACT_DRIFT (re-plan from the result is not empty),
CATALOG_DRIFT (raw catalog differs from the desired database; `+` combines),
HARNESS_ERROR, SKIPPED.

Flags (independent of the outcome):

- `DATA_LOSS`: after the source setup the lab, as SUPERUSER, runs
  `INSERT ... DEFAULT VALUES` into every ordinary/partitioned table (each in its
  own try) and then `seed-*.sql`, recording row count and md5 of `row::text` per
  table. After a successful apply every table that had rows and exists by name in
  the desired database must keep its row count, and its md5 when its column list
  is unchanged. Renamed tables are exempt by construction (not in desired by name).
- `ROLE_LEFT`: apply runs on a `max: 1` pool; `current_user, session_user,
  current_setting('role')` are read on that connection before and after (also
  after a failed or refused apply). Any difference is flagged.
- `PLAN_CHANGED` (`--applier superuser` + `--compare-baseline`): the statement
  list differs from the baseline; a statement diff is printed.

Fail-clean: on APPLY_FAIL the source database's catalog-truth lines and fact-base
root hash are compared with their pre-apply values; detail starts `clean` or
`dirty` (dirty lists the differing lines) plus the plan's segment count
(`segmentActions`, as `apply()` counts them).

## Verdicts

| verdict | when |
| --- | --- |
| `PASS` | ideal converge and OK without flags; or ideal refuse and BLOCKED / REFUSED_IDENTITY / typed capability error at plan time |
| `LOUD` | did not apply, nothing changed: PLAN_THROW / BLOCKED / REFUSED_IDENTITY, or APPLY_FAIL `clean`; `LOUD(dirty-multisegment)` for a dirty multi-segment failure |
| `NONCONVERGED` | applied, but FACT_DRIFT (with or without CATALOG_DRIFT) |
| `SILENT` | applied with CATALOG_DRIFT only, DATA_LOSS or ROLE_LEFT; or APPLY_FAIL `dirty` on a single-segment plan; or ROLE_LEFT after a failed apply |
| `UNEXPECTED_OK` | ideal refuse but it converged cleanly |
| `NA` | SETUP_FAIL, SKIPPED, HARNESS_ERROR (HARNESS_ERROR is still listed in the summary) |
| `REGRESSION` | with `--compare-baseline`: baseline verdict for the same key was PASS and now it is not (JSON `rawVerdict` keeps the real one) |

Exit code 1 if any SILENT, REGRESSION or PLAN_CHANGED; 2 if nothing was selected
or the lab crashed.

## Baselines

`--record-baseline f.jsonl` writes one line per run keyed by (scenario path
relative to `tests/owner-lab`, direction, image, applier mode, login mode, via
mode, supabase flag) with outcome, verdict, flags and the plan statements.
`--compare-baseline f.jsonl` adds REGRESSION / PLAN_CHANGED; a key missing from
the baseline prints `no-baseline` (counted, not an error).

The baselines in `baselines/` were recorded on the base commit `5200cc7c`
(origin/avallete/pg-delta-action-subject, no PoC) from a detached worktree,
with this directory copied in:

    git worktree add --detach <dir> 5200cc7c && cd <dir> && bun install && bun run build
    rsync -a --exclude baselines <poc>/packages/pg-delta/tests/owner-lab/ <dir>/packages/pg-delta/tests/owner-lab/
    cd <dir>/packages/pg-delta
    L="bun tests/owner-lab/lab.ts --suite --direction both"
    $L --image postgres:17-alpine --applier createrole --record-baseline <poc>/.../baselines/base-pg17-createrole.jsonl
    $L --image postgres:15-alpine --applier createrole --record-baseline <poc>/.../baselines/base-pg15-createrole.jsonl
    $L --image postgres:17-alpine --applier superuser  --record-baseline <poc>/.../baselines/base-pg17-superuser.jsonl
    $L --image postgres:15-alpine --applier superuser  --record-baseline <poc>/.../baselines/base-pg15-superuser.jsonl
    $L --supabase --image supabase/postgres:17.11.0.018 --record-baseline <poc>/.../baselines/base-supa17.jsonl

The `generated/` set was recorded as it stood at the time (483 scenarios);
re-record with the same commands after regenerating. Faster: run 8 shards in
parallel (`--shard i/8`, one file each) and `cat` the files; a stock run takes
about 100 s that way, a supabase run (fresh containers per run) much longer.

Runs of the PoC tree against them:

    L="bun tests/owner-lab/lab.ts --suite --direction both"
    $L --image postgres:17-alpine --compare-baseline baselines/base-pg17-createrole.jsonl --json baselines/poc-r3-pg17-createrole.jsonl
    $L --image postgres:17-alpine --applier superuser --compare-baseline baselines/base-pg17-superuser.jsonl --json baselines/poc-r3-pg17-superuser.jsonl
    $L --image postgres:17-alpine --login stepdown --json baselines/poc-r3-pg17-stepdown.jsonl
    $L --image postgres:17-alpine --via script --json baselines/poc-r3-pg17-script.jsonl

## `--supabase` mode

    bun tests/owner-lab/lab.ts --supabase --image supabase/postgres:17.11.0.018 \
      [--direction forward|reverse|both] [--suite] tests/owner-lab/supabase/<name>

Two fresh `supabase/postgres` containers are started PER RUN (roles are
cluster-global; fresh containers are the cleanest reset, ~14 s per run). The
applier is the built-in `postgres` role (NOSUPERUSER, member of
`supabase_privileged_role`, as in `containers.ts` `supabaseCluster()`),
scenarios run directly in database `postgres`, `pre-*`/`post-*`/`seed-*` run as
`supabase_admin`, and extract/plan/apply go through
`resolveProfile(pool, supabaseProfile)` (planOptions/applyOptions). The literal
`lab_applier` in scenario SQL is replaced with `postgres`. `meta.dbOwner` and
`meta.applierInherit` are ignored (a note is printed). Catalog truth and the
data oracle are restricted to non-platform schemas (`public` included); the
catalog also keeps `pg_auth_members` rows where either role was not present at
container boot, or the member is `postgres`. With `--login stepdown`, `lab_login`
is created as `supabase_admin` and granted `postgres`. `scenarios/` dirs run
unchanged; `supabase/` holds Supabase-specific scenarios.
