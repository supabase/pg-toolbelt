# pg-checks spike (T2, secure-by-default migrations)

Local spike, 2026-10-21. Spec: `secure-by-default/RFC.md` §2–§5, §8, §9; DECISIONS.md; OPEN-QUESTIONS.md.

- **Verdict:** the RFC §3 batch shape works as specified on `supabase/postgres` 15.19.0.005 and 17.11.0.005, through a port of the CLI's own pipeline executor. On 22 real projects it never changed what applied in `warn` and never timed out.
- **Main risk:** the rules, not the mechanism. Five of the nine rules ignore exposed schemas (so D1 does not hold for them). At `error`, `rls_enabled_no_policy` blocks the first migration of 4 popular starters on intentionally private tables. Per-file `error` also blocks on transient findings that a later file fixes (D17).
- **Next:** decide the D1 scope (filter rows by `metadata.schema`, or document it) and whether `rls_enabled_no_policy` stays in the core four, before T4/T5 consume the package.

## What was built

`packages/pg-checks` (`@supabase/pg-checks`, private): see its README for the API.

- `src/vendor/splinter.sql`: splinter `2026.09.1`, byte for byte. `scripts/sync-splinter.ts` (local `git show <tag>:splinter.sql`, or `--remote`) regenerates `src/vendor/splinter.ts` by cutting the file at structural boundaries: header line, `do $$ … end $$;` preamble, then `(<rule>) union all …`. The sync fails loudly on any shape change, on a missing or non-SECURITY rule, or on a checked rule that reads `splinter.*` settings. The check does not run the preamble, because none of the nine rules needs it.
- `resolvePolicy`, `buildCheckStatements` / `buildCheckBlock`, `buildAfterCommitRead`, `parseCheckError`, `parseFindings`.
- Deviation from RFC §3: `search_path` and `pgrst.db_schemas` are saved and restored inside the `DO` (plpgsql variables), not through `sbc.*` settings. Only `statement_timeout` needs a cross-statement save (`sbc.statement_timeout`). Every call outside splinter is `pg_catalog`-qualified, because the block runs under the migration's own `search_path`.
- `tests/cli-executor.ts`: a CLI-faithful executor for cli@24347954f. It does `RESET ALL`, the history DDL, and one Parse/Bind/Describe/Execute pipeline with a single Sync (a port of `PgBatchQuery`), and it follows the D22 split paths. The insert matches the CLI's `INSERT … (version, name, statements) VALUES ($1,$2,$3)`.
- `scripts/dogfood.ts`: the harness. It adds a pass (d) beyond the brief: the four core rules at `error`, the rest at `warn`.

## What was validated

| Check | Result |
| -- | -- |
| Unit: policy validation, block and read SQL, parsers, vendored file in sync | 24 pass |
| Integration, PG 17.11.0.005 + 15.19.0.005 (12 cases each): blocked file leaves no object and no history row; same via `supabase_admin` and a one-string `begin … commit` (Mgmt API shape); file's own `SET LOCAL statement_timeout`, `search_path` and `pgrst.db_schemas` restored before the history insert (trigger-observed); nothing leaks after commit or rollback; `warn` applies and is reported by the read; `off` skips; `exclude` skips only that relation; 1 ms timeout fails closed with SB002 and rolls back; file's own 600 ms statement not cut by a 500 ms check timeout; exposure scoping; split files (CONCURRENTLY, authored BEGIN/COMMIT) apply without the check and report | 24 pass |
| Mutation check: removing the restores, or the `SET LOCAL`, fails the restore and timeout tests | 2 fail as expected |

## Dogfood

All 22 sample projects ran on PG17 (20 have migrations, 1,176 files), and all 22 on PG15. Reports:

- PG17 from the bare → `supabase start` fixture: `~/.cache/supabase-pg-checks-dogfood/2026-10-21T15-24-32-224Z-pg17/REPORT.md` (canonical run)
- PG17, same fixture with the stack's `public` default-privilege changes removed: `…/2026-10-21T15-29-18-pg17-stack-legacy-acl/REPORT.md`
- PG15 bare image (no stack fixture exists for 15): `…/2026-10-21T15-26-33-153Z-pg15/REPORT.md`; PG17 bare: `…/2026-10-21T15-27-44-pg17-bare/REPORT.md`
- An earlier three-pass run, superseded, is in `…/2026-10-21T15-21-16-388Z-pg17/`.

Canonical PG17 run:

| Outcome | (a) none | (b) warn | (c) all error | (d) core error |
| -- | -- | -- | -- | -- |
| applied | 1087 | 1053 | 24 | 98 |
| applied_with_findings (split, D22) | 0 | 34 | 0 | 1 |
| blocked | 0 | 0 | 18 | 12 |
| timed_out | 0 | 0 | 0 | 0 |
| apply_error | 4 | 4 | 1 | 1 |

- **(a) vs (b):** same files applied, catalog md5 equal for every project, and history rows equal applied files. No anomalies in any run. The 4 baseline errors are environmental: `pgsodium` schema, timescaledb, the storage delete guard, and a project bug.
- **Final-state findings, (b):** `function_search_path_mutable` 358, `rls_policy_always_true` 47, `rls_enabled_no_policy` 36, `security_definer_view` 1, `rls_disabled_in_public` 0.
- **(c), all rules at error:** 18 of 20 projects blocked, 16 at their first file. `function_search_path_mutable` blocks 15 projects.
- **(d), core rules at error:** 12 blocked. `rls_enabled_no_policy` blocks 10, mostly private tables: the Stripe `customers` table in vercel, Hikari, KolbySisk and devtodollars, plus a `dummy` schema in grida.
- **Cost:** the after-commit read of all nine rules takes p50 65 ms, p95 180 ms, max 581 ms, on up to about 2.1k `pg_class` rows and 1.3k policies (carbon). Overhead per file in (d) vs (a) is p50 56 ms. That leaves plenty of room under 2 s on local hardware.
- **D22 is common:** 37 split files, 33 of them in carbon (authored `BEGIN/COMMIT`), get no in-transaction check.

## Open questions: new evidence

| # | Evidence |
| -- | -- |
| O8 | Not tested hosted. Locally, `postgres` (non-superuser) may set `sbc.*` on both images. The bare image has `log_statement = ddl` (RFC says `all`), and `DO` is not DDL. The block is about 77 KB of text per migration. |
| O9 | **Already done upstream.** The `pg_depend.classid` filter is in splinter since `2026.07.0` (PR #166, 5fc6b90) on every branch. BENCH.md measured the CLI's stale embedded copy. Vendoring ≥ 2026.07.0 meets the prerequisite. |
| O10 | `SB001`/`SB002` are accepted by `RAISE` on 15.19 and 17.11. Class `SB` is in the implementation-defined range (I–Z), so it is not reserved. |
| O12/O19 | The harness reads `[api].schemas` (grida exposes 15 schemas). It only matters for 4 rules; see problem 1. |
| O13 | Splinter's `remediation` is only the docs URL for all nine rules, so `fix` = `docs`. RFC §8's `Fix:` text needs a hand-written per-rule template in pg-checks. |
| O18 | A read costs about 65 ms at p50, so a before/after pair per run is cheap at this scale. |
| O23 | **Answered:** `BEGIN; set_config(..., true); SELECT; ROLLBACK` keeps the read local (tested). Two caveats. (1) After any local `set_config('pgrst.db_schemas', …)`, the session keeps the placeholder as `''`, not NULL, and splinter's `coalesce(…, 'public')` then sees *no* exposed schema. Any later splinter run on that pooled session (Advisors, `db advisors`) silently checks nothing unless it sets the value. (2) The read's `BEGIN`/`ROLLBACK` must not run inside a caller's transaction. |

## New problems for the RFC

1. **D1 does not hold for 5 of the 9 rules.** `rls_enabled_no_policy`, `policy_exists_rls_disabled`, `rls_policy_always_true`, `function_search_path_mutable` and `rls_references_user_metadata` ignore `pgrst.db_schemas` and check every user schema. In grida, (d) blocked on `dummy.t1` in a schema that is not exposed. Either filter rows by `metadata.schema` ∈ exposed in pg-checks (a row filter, not a rule edit), or state the scope per rule.
2. **Stack default privileges change what fires.** The bare → `supabase start` fixture (17.6.1.167) revokes `SELECT/INSERT/UPDATE/DELETE` on `public` tables from `anon/authenticated`. `rls_disabled_in_public` (grant-aware) then never fires: 0 findings. The finding appears in the file that later `GRANT`s, so attribution moves to the GRANT file. Example: marmelab's `grant_init_state_to_api_roles.sql` is blocked by an older `security_definer_view`. With legacy ACLs, `rls_disabled_in_public` is introduced by 90 files.
3. **Transient findings (D17).** In the legacy-ACL run, 90 files introduce `rls_disabled_in_public`, and 1 is left at the end. Carbon blocks at file 3 even though its tables get RLS later. Per-file `error` punishes the table-then-RLS file layout, which is common in real projects.
4. **`rls_enabled_no_policy` at `error` is a false-positive generator.** RLS on with no policy is the documented "service role only" pattern (splinter level INFO). It blocks the first migration of the official Vercel starter and 3 others. Reconsider it for the core four (D8), or pair it with `exclude`/O4.
5. **Payload sizes.** The check sends the full 75 KB splinter query in every migration. Because the release splits cleanly per rule, pg-checks could send only the selected branches (about 5–10× smaller) without touching rule SQL. `DETAIL` carries full splinter rows (about 0.6–1 KB each) for all errors *and* warnings. A project with hundreds of warn findings gets a DETAIL of hundreds of KB. Consider aggregating only `name/detail/remediation/metadata`.
6. **Not a security boundary.** The migration runs as the owner and the check runs as the same role, so the check is a guardrail. It is `pg_catalog`-qualified and evaluates splinter under `search_path = ''`, so user objects cannot shadow it.
7. **Repo:** `packages/pg-topo` `knip` already fails on `main` (unused `src/index.ts`, `src/validate-sql.ts`). That is unrelated to this spike.

Not done: hosted project / Supavisor (O8); the Mgmt API executor beyond the one-string block test; replay mode (D18); a PG15 stack fixture (the PG15 dogfood stops early on missing `storage.buckets`).

## O8 hosted staging results

One throwaway staging project (PG 17.11.0.003, micro, api.supabase.green, deleted afterwards). Probe: `packages/pg-checks/scripts/o8-probe.ts`. Full report: `~/.cache/supabase-pg-checks-dogfood/o8-20261021-1737/REPORT.md`.

| Cell | Verdict |
| -- | -- |
| Direct, `postgres` (non-superuser): blocked file raises SB001, no table, no history row | PASS |
| Direct: secure file applies, its own `SET LOCAL statement_timeout` / `search_path` survive the check | PASS |
| Direct: `set_config('sbc.*', …, true)` under supautils | PASS |
| Direct: timeout reports SB002 | **FAIL**: SB002 at 5 and 20 ms, raw `57014` at 1 and 50 ms (the cancel escapes the inner `exception` block). Rollback is correct either way, but `parseCheckError` would not classify it. |
| Supavisor transaction mode (6543): block and secure apply | PASS. One backend reused across clients, no `statement_timeout` / `search_path` leak. `pgrst.db_schemas` stays `''` (NULL on a fresh session) on the pooled backend, so O23 holds hosted. |
| Supavisor session mode (5432): block | PASS |
| Log volume | Hosted `log_statement=ddl`, `pgaudit.log=none`, no role override raises it: a passing check is not logged. A failing check is (`log_min_error_statement=error` writes the ~75 KB statement). Bytes not observable: staging analytics has no postgres log source for the project. |
| Mgmt API `POST /database/query`, `begin; file; check; insert; commit` | Works. SB001 returns HTTP 400 with `message` = `ERROR:  SB001: security check failed\nDETAIL:  {findings json}\nCONTEXT: …`; there is no separate SQLSTATE field, so clients must parse the text. NOTICE/WARNING are dropped. Only the last row-returning statement's rows come back. About 2.5 s per call whatever the SQL. |

Other facts: a fresh project has zero findings across all nine rules in `public`; the check adds about 120 ms over a 90 ms RTT (one rule or nine); the after-commit read as one string works through the API (zero findings returns the `set_config` row, which `parseFindings` ignores).

## Known pitfalls

Both were found on hosted staging (O8) and are pinned by tests.

1. **The timeout can escape the check's handler.** The cancel from `SET LOCAL statement_timeout` can land in any step of the `DO`, not only the lint query. Hosted runs at 1 ms and 50 ms surfaced a raw `57014` instead of `SB002` (rollback stayed correct).
   - Fixed: the `query_canceled` handler now spans the whole `DO` body.
   - Residual: a cancel while Postgres compiles the `DO` is uncatchable. Executors must map a raw `57014` from a check statement to `timed_out` with `parseCheckError(error, { fromCheck: true })`. The CLI pipeline knows the failing statement index. A one-string executor (Mgmt API `begin; …; commit;` through `/database/query`) cannot tell it from the file's own timeout, so it reports a plain apply error in that rare case.
2. **`pgrst.db_schemas` cannot be restored to unset.** Once any `set_config('pgrst.db_schemas', …)` runs on a session, Postgres keeps the placeholder: after rollback or `RESET` it reads `''`, never NULL again (checked on postgres:17-alpine). Splinter does `coalesce(current_setting('pgrst.db_schemas', true), 'public')`, so `''` means "no exposed schema" and the exposure-scoped rules silently find nothing. Through Supavisor the backend is reused, so a later client inherits `''`.
   - Not fixable in SQL. Rule: every splinter run (check block, after-commit read, and any other caller on a pooled connection, e.g. Advisors) must set `pgrst.db_schemas` itself. pg-checks always does.
   - Do **not** ask splinter to treat `''` like unset (`nullif`): `''` is how a project with the Data API off says "nothing exposed" (Studio writes `db_schema = ''`; splinter test 0017 relies on it), so that change would report exposure findings on projects without an API. Pass `exposedSchemas: []` for Data API off. Other callers are tracked in CLI-2824 (CLI `db advisors`), CLI-2825 (platform Advisors), FE-4708 (pg-meta), CLI-2826 (pg-checks: skip the set when unneeded).

## Spike round 3: D27, D28, fix text, splinter level, CLI-2826

Local, 2026-10-22. Same images; pg-meta `v0.100.0` for D28.

- **Verdict:** all five land with no change in what applies or blocks. The PG17 dogfood re-run matches the canonical run file for file, and the check overhead drops from p50 56 ms to 13 ms.
- **D27, send only the selected rules.** The sync now cuts `splinter.sql` into one branch per rule and checks each branch against the tag's `lints/*.sql` (the transform in splinter's `bin/compile.py`), so a cut cannot land inside a rule. `src/vendor/splinter.ts` exports `RULE_SQL` for the nine rules. The check and both reads union only the rules they need. None of the nine reads `splinter.*`, so the `public_buckets` preamble is not vendored. Each rule run alone returns exactly the full release's rows for that rule (`tests/rule-sql.test.ts`, PG17 and PG15, a fixture with findings for all nine).
- **D28, warn read before commit.** `buildInTransactionWarnRead` goes between the history insert and `commit`. Its `DO` catches `query_canceled` and `others` and stores `{findings}` or `{read_error}` in `sbc.findings`. It restores `statement_timeout` inside the `DO`, then one `sbc_findings` row comes back. `parseInTransactionWarnRead` finds that row by column name. Through a real pg-meta (`tests/mgmt-api.test.ts`): the happy path returns 200 and commits; a 1 ms read timeout returns 200 with `read_error: 57014`, and the migration still commits (4 of 4 runs); SB001 returns 400 and commits nothing; with zero findings only the sentinel row comes back, not the file's own rows. Residual risk: a cancel that lands while Postgres compiles the `DO` can still roll the migration back. At the 2 s default the timer cannot fire that early.
- **O13 fix text.** `Finding.fix` is now pg-checks' own text per rule, naming the object (`src/fix.ts`). `docs` stays splinter's URL.
- **Splinter level.** `Finding.splinterLevel` is splinter's `level` (`ERROR | WARN | INFO`), so a client can show that `rls_enabled_no_policy` is `INFO` in splinter even when the policy blocks on it.
- **CLI-2826.** All three paths set `pgrst.db_schemas` only when `coalesce(current, 'public')` differs from the exposed list. A public-only project never creates the placeholder, so a fresh or pooled session still reads NULL afterwards (`tests/db-schemas.test.ts`). A leftover `''` is overridden, an equal value is left alone, and `[]` (Data API off) sets `''`.

SQL the check or read adds to each migration, `exposedSchemas = ["public"]`, in bytes:

| Statement | Before | After |
| -- | -- | -- |
| Check, all rules `error`, or core `error` + rest `warn` | 76,238 | 27,346 |
| Check, one rule `error`, rest `off` | 75,796 | 3,444 |
| After-commit read, all `warn` | 74,601 | 25,644 |
| In-transaction warn read, all `warn` | n/a | 26,877 |

At `error`, the check still includes every `warn` rule, because their rows go into `DETAIL`. A default policy therefore sends all nine rules.

Dogfood PG17 re-run (`~/.cache/supabase-pg-checks-dogfood/2026-10-22T10-47-12-292Z-pg17/REPORT.md`) against the canonical run:

| | Canonical (2026-10-21) | Round 3 |
| -- | -- | -- |
| Outcomes (a)/(b)/(c)/(d): applied, with findings, blocked, apply_error | identical per file | identical per file |
| Final findings (b): search_path / always_true / no_policy / definer_view | 358 / 47 / 36 / 1 | 358 / 47 / 36 / 1 |
| Catalog md5, history rows, anomalies | — | identical, 0 anomalies |
| Check overhead vs (a), (c) / (d), p50 · p95 | 56 · 163 / 56 · 153 ms | 13 · 21 / 13 · 49 ms |
| After-commit read (b), p50 · p95 | 65 · 180 ms | 69 · 269 ms |

- `blockedBy` and `introduced` differ only in order in 12 files, and are equal as sets. The union now follows the `RULES` order instead of splinter's file order, so for example `rls_policy_always_true` rows now come before `function_search_path_mutable`.
- The read cost did not drop, but the check overhead did. This was not profiled. A likely reason is that the old filter on the constant `name` column already let the planner prune the other branches at execution, so the gain comes from parse and plan only. The read's p95 is noisy: the four passes run on concurrent containers.
