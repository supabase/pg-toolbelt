# owner-lab

Runs a scenario (a.sql -> b.sql) end to end as a NON-superuser applier
(`lab_applier`, CREATEROLE NOSUPERUSER) on real Postgres, then classifies the
outcome and compares raw catalogs by name (owners, ACLs, role attributes,
`pg_auth_members`, default ACLs).

    cd packages/pg-delta
    export DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock
    bun tests/owner-lab/lab.ts --image postgres:17-alpine tests/owner-lab/scenarios/<name>
    bun tests/owner-lab/lab.ts --image postgres:17-alpine --all
    bun tests/owner-lab/lab.ts --image postgres:17-alpine --corpus [--filter <substr>] --json out.jsonl

Flags: `--json <file>`, `--verbose`, `--direction forward|reverse|both`,
`--applier createrole|superuser`.

Scenario dir: `a.sql`, `b.sql` (required, run as the applier); optional
`pre-a/pre-b.sql` and `post-a/post-b.sql` (run as the cluster superuser before
/ after), `meta.json` (`minVersion`, `maxVersion`, `expect` converge|refuse,
`applierInherit`, `dbOwner`, `executeAs`, `notes`; corpus `renames` and
`settleDesired` are honoured).

Outcomes: OK, SETUP_FAIL, PLAN_THROW, BLOCKED (the plan carries blockers; not
applied), REFUSED_IDENTITY (apply refused a plan bound to another applier),
APPLY_FAIL, FACT_DRIFT, CATALOG_DRIFT (combined with `+` when both),
HARNESS_ERROR, SKIPPED. `expect: "refuse"` is met by BLOCKED, REFUSED_IDENTITY,
or a typed `CapabilityError`.

## `--supabase` mode

    bun tests/owner-lab/lab.ts --supabase --image supabase/postgres:17.11.0.018 \
      [--direction forward|reverse|both] tests/owner-lab/supabase/<name>

Two fresh `supabase/postgres` containers are started PER RUN (roles are
cluster-global; fresh containers are the cleanest reset, ~14 s per run). The
applier is the built-in `postgres` role (NOSUPERUSER, member of
`supabase_privileged_role`, as in `containers.ts` `supabaseCluster()`),
scenarios run directly in database `postgres`, `pre-*`/`post-*` run as
`supabase_admin`, and extract/plan/apply go through
`resolveProfile(pool, supabaseProfile)` (planOptions/applyOptions). The literal
`lab_applier` in scenario SQL is replaced with `postgres`. `meta.dbOwner` and
`meta.applierInherit` are ignored (a note is printed). Catalog truth is
restricted to non-platform schemas (`public` included) plus `pg_auth_members`
rows where either role was not present at container boot, or the member is
`postgres`. `scenarios/` dirs run unchanged; `supabase/` holds
Supabase-specific scenarios.
