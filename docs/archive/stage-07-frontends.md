# Stage 7: Frontends (shadow-DB SQL loader · snapshots)

> Part of the [north-star architecture](../architecture/target-architecture.md) (§3.2).
> Depends on: stages 2, 6. Gate: declarative scenarios in the corpus;
> loader rejection tests.

## Goal

The declarative workflow lands: SQL files become a fact base via a shadow
database, then flow through the exact same diff/plan/proof path as
everything else. This is the stage where the old round-apply engine and
pg-topo's production role are *replaced*, not ported.

## Deliverables

1. **`loadSqlFiles(roots, shadowTarget): FactBase`** — six steps in
   execution order (the four §3.2 shadow-loader obligations, bracketed by
   discovery and extraction):
   1. *Discovery*: deterministic file enumeration (lexicographic, like
      migration tools — document the contract).
   2. *Loading with fail-safe ordering*: apply statements; on dependency
      errors, defer and retry in bounded rounds **against the shadow**
      (port the round mechanics from the old
      `declarative-apply/round-apply.ts` — they are correct for this; what
      was wrong was using them against live targets). Optionally pre-sort
      via the dev layer when available. Exhausted rounds → structured error
      listing stuck statements and their PG errors; nothing extracted.
   3. *Shared-object isolation*: snapshot `pg_roles`/`pg_auth_members`
      before loading; if loading changed them and the shadow is not an
      isolated cluster, fail with the §3.2 explanation. Loader config
      declares which mode it's in (`databaseScratch` vs `isolatedCluster`);
      the corpus covers both.
   4. *Body re-validation*: loading ran with `check_function_bodies = off`;
      re-validate routine bodies with checks on (port the validation pass
      semantics from `round-apply.ts:445-448`). Failures are loader errors,
      not facts.
   5. *DML rejection*: after loading, any user table containing rows →
      structured error naming the tables. Parser-free by design.
   6. *Extraction*: the stage-2 extractor against the shadow; returned fact
      base is tagged with provenance (`source: sqlFiles`).
2. **Snapshot frontend**: `loadSnapshot(path): FactBase` — deserialize +
   format-version check + digest re-verification (a corrupted snapshot must
   not silently plan).
3. **Corpus additions**: declarative scenarios — out-of-order files,
   a typo'd function body (must be rejected), a role-creating file in
   database-scratch mode (must be rejected), an `INSERT`-bearing file (must
   be rejected), and the happy path against a real schema.

## What to look for (pitfalls)

- **Some inputs are unorderable in principle.** Two `CREATE TABLE`
  statements with mutual *inline* FK clauses converge under no permutation
  and no number of retry rounds — the user must split one FK into a
  separate `ALTER TABLE … ADD CONSTRAINT`. The stuck-statement error for
  this case should say exactly that (and the dev layer can suggest the
  split). The ordering contract is **convergence or loud failure, never
  silent wrongness** — reordering can never change what the SQL means,
  because Postgres elaborates every statement. Add a corpus scenario for
  the mutual-FK case asserting the diagnostic.
- **Don't resurrect the retry engine as a production path.** The bounded
  rounds run against the throwaway shadow only. The plan that eventually
  touches a live target comes from the planner; the loader's job ends at a
  fact base.
- **Shadow provisioning** belongs to the caller (CLI/harness): a template
  database, a container, or a user-supplied scratch URL. The loader
  *verifies* emptiness before loading (non-empty shadow → error) rather
  than provisioning.
- **Sequences and identity columns** hold non-initial values after DDL with
  defaults — the DML check is "rows in tables", not "sequence state";
  document that sequence `last_value` is not desired state (matches old
  behavior).
- **Extensions in shadow**: files with `CREATE EXTENSION` need the
  extension available in the shadow image. Surface a clear error;
  the corpus's `requires` tags already model image needs.
- **The shadow executes arbitrary user SQL.** Treat it as such: the shadow
  must never share a cluster with anything valuable, its credentials must
  not open anything beyond itself, and `isolatedCluster` mode is the only
  safe home for files that touch shared objects. This is a trust boundary,
  not just a hygiene rule.

## Gate

- Declarative corpus scenarios green end-to-end (files → shadow → fact
  base → plan → proof).
- All four rejection behaviors covered by negative tests.
- Out-of-order file scenario converges via bounded rounds.
- Snapshot frontend round-trip + corruption test green.
