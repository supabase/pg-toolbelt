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
