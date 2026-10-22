# @supabase/pg-checks (spike, private)

Security checks on migration apply, T2 of "Secure-by-default migrations"
(RFC §2–§5, §8). It vendors a released `splinter.sql`, builds the SQL an
executor appends to each migration, and parses what comes back. Nothing is
installed in the user database.

## API

```ts
import {
  resolvePolicy,
  buildCheckStatements,
  buildCheckBlock,
  buildAfterCommitRead,
  buildInTransactionWarnRead,
  parseCheckError,
  parseFindings,
  parseInTransactionWarnRead,
} from "@supabase/pg-checks";

const policy = resolvePolicy(config.db?.migrations?.checks); // throws PolicyError
const exposedSchemas = config.api?.schemas ?? ["public"];

// In the migration's transaction, after the file, before the history insert.
// [] / "" when no rule is at "error".
const statements = buildCheckStatements(policy, { exposedSchemas, timeoutMs: 2000 }); // pipelined executors (CLI)
const script = buildCheckBlock(policy, { exposedSchemas });                          // one-string executors (Mgmt API)

try { /* run file + statements + history insert */ } catch (error) {
  // fromCheck: the failing statement was one of `statements` (a cancel while the DO compiles is a raw 57014).
  const check = parseCheckError(error, { fromCheck }); // { kind: "blocked", errors, warnings } | { kind: "timed_out" } | null
}

// After commit, outside any transaction: begin; set_config...; select; rollback.
const read = buildAfterCommitRead(policy, { exposedSchemas });
const findings = parseFindings(rowsOf(read.statements[read.resultIndex]), policy);

// One-string executors (Mgmt API, D28): read before commit, in the same string.
// `begin; <file>; <script>; <history insert>; <warnRead> commit;`  ("" when every rule is off)
const warnRead = buildInTransactionWarnRead(policy, { exposedSchemas, timeoutMs: 2000 });
const result = parseInTransactionWarnRead(responseRows, policy); // { findings } | { readError }
```

- `resolvePolicy(input)`: rules `rls_disabled_in_public`, `rls_enabled_no_policy`,
  `policy_exists_rls_disabled`, `security_definer_view`, `rls_policy_always_true`,
  `sensitive_columns_exposed`, `auth_users_exposed`, `function_search_path_mutable`,
  `rls_references_user_metadata`; severity `error | warn | off`, absent = `warn`;
  `exclude: { <rule>: ["schema.name"] }` (per rule, mirrors
  `[db.migrations.checks.exclude]`; duplicates removed). Unknown rules, severities and malformed
  exclusions are all reported in one `PolicyError`.
- Every lint select unions only the selected rules' splinter SQL (D27): about
  3.4 KB for one rule, 27 KB for all nine, instead of the 75 KB file.
- Check block: `set_config('sbc.statement_timeout', …)`, `SET LOCAL statement_timeout`,
  one `DO` block, restore. The `DO` saves and restores `search_path` (`''` for
  splinter) and `pgrst.db_schemas` (the exposed schemas) itself. A finding at
  `error` raises `SB001` with `DETAIL = {"errors": [...], "warnings": [...]}`
  (full splinter rows); a check over its timeout raises `SB002`.
- In-transaction warn read: the same save/`SET LOCAL`/`DO` shape, but the `DO`
  never raises from the lint: it catches `query_canceled` and `others` and stores
  `{"findings": [...]}` or `{"read_error": "<sqlstate>: <message>"}` in
  `sbc.findings`, restores `statement_timeout` itself, then one
  `select … as sbc_findings` row comes back (pg-meta returns the last result with
  rows, so the file's own rows never pass for findings). Default timeout 2000 ms.
- `pgrst.db_schemas` is set only when splinter's own
  `coalesce(current_setting('pgrst.db_schemas', true), 'public')` would not
  already give the exposed schemas (CLI-2826). A public-only project never creates
  the placeholder; `exposedSchemas: []` (Data API off) sets `''`.
- Findings: `{rule, severity, splinterLevel, schema, name, type, detail, fix, docs}`
  (RFC §8). `severity` is the policy's (`error | warn`); `splinterLevel` is
  splinter's own `level` for the rule (`ERROR | WARN | INFO`, `null` if absent),
  e.g. `rls_enabled_no_policy` is `INFO` in splinter. `fix` is pg-checks' own
  per-rule text naming the object (O13, `src/fix.ts`); `docs` is splinter's
  `remediation` URL.

## Vendored splinter

`src/vendor/splinter.sql` is splinter `2026.09.1`, byte for byte.
`src/vendor/splinter.ts` is generated from it: `RULE_SQL`, one entry per checked
rule, each the rule's `(…)` branch of the release's `(<rule>) union all (<rule>) …`
query, verbatim. The sync cuts the file at its structural boundaries (header
line, `do $$ … end $$;`, then the branches) and checks every branch against the
tag's `lints/*.sql` as splinter's `bin/compile.py` writes them, so a cut cannot
land inside a rule. It fails if the shape changes, a branch differs from its lint
file, a checked rule is missing or not `SECURITY`, a checked rule reads a
`splinter.*` setting (the preamble is not vendored: it only sets
`splinter.public_buckets`, read by rule 0025 alone), or the query contains the
check's `$sbc` dollar-quote tags.

```bash
bun run sync-splinter                      # git show 2026.09.1:splinter.sql from ~/Documents/Programming/Supa/splinter
bun run sync-splinter --tag 2026.10.0 --repo ../splinter
bun run sync-splinter --tag 2026.10.0 --remote   # raw.githubusercontent.com + GitHub contents API
```

## Tests

```bash
bun run test                               # unit (no Docker)
DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock bun run test:integration   # supabase/postgres 17.11.0.005 + 15.19.0.005
PGCHECKS_PG=17 bun run test:integration
bun run dogfood --pg 17                    # real projects, see below
```

`tests/cli-executor.ts` replays a file the way the CLI's TS executor does
(`RESET ALL`, history DDL, one extended-protocol pipeline with one Sync, D22
split paths) with the check inserted before the history insert.
`tests/mgmt-api.ts` starts supabase/postgres behind a real pg-meta
(`postgres-meta:v0.100.0`, as `supabase_admin`) and builds the platform's
`begin; file; history upsert; commit;` string for `/query`.

`scripts/dogfood.ts` copies each project of
`supabase-config-real-world-samples` to `~/.cache/supabase-pg-checks-dogfood/<ts>/`
and replays its migrations on fresh containers in four passes: (a) no check,
(b) all rules `warn` with an after-commit read per file, (c) all rules `error`,
(d) the four core rules `error`. On PG17 it starts from pg-delta's bare →
`supabase start` fixture (auth/storage tables, stack default privileges);
`--baseline none` uses the bare image.

## Open findings from the spike

See `docs/roadmap/pg-checks-spike.md`. Short version:

- Five of the nine rules ignore `pgrst.db_schemas` and check every user schema
  (`rls_enabled_no_policy`, `policy_exists_rls_disabled`, `rls_policy_always_true`,
  `function_search_path_mutable`, `rls_references_user_metadata`), so D1's
  "exposed schemas only" does not hold for them.
- After any `set_config('pgrst.db_schemas', …, true)`, the session keeps the
  placeholder as `''`, and splinter then sees no exposed schema. Every read must
  make sure splinter sees the right value. pg-checks now sets it only when
  needed (CLI-2826), so public-only projects never leave `''` behind; any other
  exposed list still does. See "Known pitfalls" in
  `docs/roadmap/pg-checks-spike.md`.
- The `pg_depend.classid` fix (O9) is already in splinter since 2026.07.0.
- Only the selected rules' SQL is sent (D27), but at `error` the check also
  carries every `warn` rule (their rows go into `DETAIL`), so a default policy
  still sends all nine (≈27 KB).
