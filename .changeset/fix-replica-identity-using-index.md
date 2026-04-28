---
"@supabase/pg-delta": patch
---

fix(pg-delta): preserve `REPLICA IDENTITY USING INDEX` on tables instead of silently reverting to `DEFAULT` on declarative sync.

The table extractor only stored `replica_identity` as a single character (`'d' | 'n' | 'f' | 'i'`) and discarded the index name when the mode was `'i'`. The diff path then explicitly skipped mode `'i'` ("handled by index changes" — but no such handler existed), and `AlterTableSetReplicaIdentity.serialize()` fell back to `REPLICA IDENTITY DEFAULT` for that mode. Compounding this, `Index.is_replica_identity` participated in equality and was marked non-alterable, so toggling the flag on the index triggered a spurious `DROP INDEX` + `CREATE INDEX` — and Postgres reverts the table to `REPLICA IDENTITY DEFAULT` whenever the configured replica-identity index is dropped.

End result: a table configured with `ALTER TABLE foo REPLICA IDENTITY USING INDEX foo_idx` would extract as `replica_identity = 'i'` but produce no setter on diff. The next `declarative sync` would generate a migration that dropped the user's index, reset the table to `DEFAULT`, and recreated the index — never converging (reported as supabase/cli#5141).

The fix:

- `Table.replica_identity_index` is extracted via `pg_index.indisreplident` and included in `dataFields`, so the index name participates in equality.
- `AlterTableSetReplicaIdentity` now serializes `REPLICA IDENTITY USING INDEX <name>` for mode `'i'` and declares the index as a `requires` dependency so it is created first.
- The table diff emits the change for all modes (including `'i'`) on both `CREATE` and `ALTER`, and re-emits when the configured index name changes while staying in `'i'` mode.
- `Index.is_replica_identity` is no longer in `dataFields` / `NON_ALTERABLE_FIELDS`; the table side is the source of truth, set via `ALTER TABLE`. This stops the spurious `DROP INDEX` + `CREATE INDEX` cycle.
