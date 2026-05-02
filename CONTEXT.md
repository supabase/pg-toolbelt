# Context

Shared vocabulary used across `pg-delta` and `pg-topo`.

## pg-delta

**catalog** — a resolved snapshot of one database's schema: all objects, plus
the `pg_depend` rows that link them. Produced by `extractCatalog(pool)` or
deserialized from a snapshot.

**change** — one unit of schema mutation (e.g. `CreateTable`, `AlterViewSetOptions`).
Every change has `operation`, `objectType`, `scope`, `phase`, and `serialize()`.

**phase** — which execution pass a change runs in: `"drop"` (reverse
dependency order, against the main catalog) or `"forward"` (forward
dependency order, against the branch catalog). Determined by the change
itself via `change.phase`.

**plan** — the artifact `createPlan` produces: the ordered list of SQL
statements, plus risk classification and source/target fingerprints.
