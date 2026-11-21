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
| `--via apply\|script` | `script`: render with `renderApplyScript`, split the text into statements (psql rules: quotes, dollar quotes, comments) and send them ONE AT A TIME over one connection, as the script header says; BEGIN/COMMIT are just statements. A render refusal is BLOCKED. After a failed statement the lab sends `ROLLBACK` (a real runner would exit) so the session state can be read |
| `--no-reference` | skip the superuser reference run (see below) |
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

## Superuser reference (createrole modes only, on by default)

For a createrole run whose verdict depends on it (a drifted/NONCONVERGED result,
or a loud failure; never for clean PASS, ROLE_LEFT or dirty failures) the lab
resets the clusters, rebuilds source and desired exactly as before (same files,
same roles, same auto-seed), plans WITHOUT any capability (stock: no
`capability`; supabase: `resolveProfile(..., { restrictToApplier: false })`) and
applies that plan as the cluster superuser (`supabase_admin` in supabase mode).
Reference outcomes: `REF_OK`, `REF_NONCONVERGED` (re-plan not empty),
`REF_APPLY_FAIL`, `REF_PLAN_THROW`. JSON field `reference` carries outcome,
detail, reference DATA_LOSS tables, plan statements and `sameResult`.

Comparison main-result vs reference-result is on the catalog-truth lines, with
`pg_auth_members` grantor = applier and grantor = bootstrap superuser as one
token, and rows whose member is the bootstrap superuser ignored. Owner and ACL
lines (grantors included) are compared exactly. "Same" means every way the main
result deviates from desired is also a deviation of the reference (main may be
CLOSER to desired, e.g. it revokes the applier's own memberships that the
superuser plan leaves). JSON `reference.strictlyIdentical` is the stricter
identical-line-sets test.

## Verdicts

| verdict | when |
| --- | --- |
| `PASS` | ideal converge and OK without flags; or ideal refuse and BLOCKED / REFUSED_IDENTITY / typed capability error at plan time |
| `LOUD` | did not apply, nothing changed: PLAN_THROW / BLOCKED / REFUSED_IDENTITY, or APPLY_FAIL `clean`; `LOUD(dirty-multisegment)` for a dirty multi-segment failure |
| `NONCONVERGED` | applied, but FACT_DRIFT (with or without CATALOG_DRIFT); flag `SAME_AS_SUPERUSER` when the result is no worse than the reference |
| `ENGINE_GAP` | applied, result != desired (CATALOG_DRIFT and/or DATA_LOSS) but same as the superuser reference and the same DATA_LOSS tables: a pre-existing engine fidelity gap, not an authorization bug |
| `LOUD_ENGINE` | loud (PLAN_THROW / BLOCKED / APPLY_FAIL clean) and the reference also fails (`REF_APPLY_FAIL` / `REF_PLAN_THROW`): the superuser cannot apply it either |
| `SILENT` | applied with CATALOG_DRIFT only or DATA_LOSS that the superuser reference does not share (main-vs-reference diff lines are printed as `vs-superuser`), or ROLE_LEFT; or APPLY_FAIL `dirty` on a single-segment plan; or ROLE_LEFT after a failed apply |
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
with this directory copied in; the PoC runs (`poc-r3-*`) come from a second
detached worktree at the PoC commit (so edits to `src/` in the working tree do
not leak in). `generated/` is the committed set (483 scenarios).

    git worktree add --detach <base> 5200cc7c && cd <base> && bun install && bun run build
    rsync -a --exclude baselines <poc>/packages/pg-delta/tests/owner-lab/ <base>/packages/pg-delta/tests/owner-lab/
    cd <base>/packages/pg-delta
    L="bun tests/owner-lab/lab.ts --suite --direction both"
    R=<poc>/packages/pg-delta/tests/owner-lab/baselines
    $L --image postgres:17-alpine --applier createrole --record-baseline $R/base-pg17-createrole.jsonl
    $L --image postgres:15-alpine --applier createrole --record-baseline $R/base-pg15-createrole.jsonl
    $L --image postgres:17-alpine --applier superuser  --record-baseline $R/base-pg17-superuser.jsonl
    $L --image postgres:15-alpine --applier superuser  --record-baseline $R/base-pg15-superuser.jsonl
    $L --image postgres:17-alpine --login stepdown     --record-baseline $R/base-pg17-stepdown.jsonl
    $L --supabase --image supabase/postgres:17.11.0.018 --record-baseline $R/base-supa17.jsonl
    $L --supabase --image public.ecr.aws/supabase/postgres:15.19.0.018 --record-baseline $R/base-supa15.jsonl

Runs of the PoC tree (worktree at the PoC commit, same `rsync` of this directory):

    $L --image postgres:17-alpine --compare-baseline $R/base-pg17-createrole.jsonl --json $R/poc-r3-pg17-createrole.jsonl
    $L --image postgres:15-alpine --compare-baseline $R/base-pg15-createrole.jsonl --json $R/poc-r3-pg15-createrole.jsonl
    $L --image postgres:17-alpine --login stepdown --compare-baseline $R/base-pg17-stepdown.jsonl --json $R/poc-r3-pg17-stepdown.jsonl
    $L --supabase --image supabase/postgres:17.11.0.018 --compare-baseline $R/base-supa17.jsonl --json $R/poc-r3-supa17.jsonl
    # superuser: add --applier superuser and compare against base-pg17-superuser.jsonl

Speed: run 8 processes with `--shard i/8` (each its own `--json` /
`--record-baseline` file) and `cat` them. Stock configs take 2 to 4 minutes that
way (the reference runs included); a supabase run starts fresh containers for
every run and every reference, 25 to 50 minutes on 48 shards, 8 at a time.

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
