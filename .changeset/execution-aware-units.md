---
"@supabase/pg-delta": major
---

Replace the flat `plan.statements` list with execution-aware migration units.

A plan is now an ordered list of `MigrationUnit`s (`plan.units`) plus session-level statements (`plan.sessionStatements`). Each unit carries an explicit `transactionMode` and a boundary `reason`, so plans whose statements cannot share one transaction are represented and applied correctly:

- `ALTER TYPE ... ADD VALUE` and any later statement now run in separate transactions, fixing PostgreSQL error 55P04 ("unsafe use of new value of enum type") when a migration adds an enum value and uses it (#262).
- Statements PostgreSQL rejects inside a transaction block — `CREATE SUBSCRIPTION` with `connect = true`, `ALTER SUBSCRIPTION ... SET PUBLICATION` with implicit `refresh = true`, `DROP SUBSCRIPTION` with an associated replication slot — are applied as standalone non-transactional units instead of failing inside `BEGIN`/`COMMIT`.

Execution semantics are declared on the change classes (`nonTransactional`, `commitBoundary`), never inferred from rendered SQL.

**Migrating from `plan.statements`:**

```ts
// before
const script = plan.statements.join(";\n");

// after — transaction-aware script (BEGIN/COMMIT per unit, unit headers)
const script = renderPlanSql(plan);
// or one numbered file per unit (also: pgdelta plan --output-dir <dir>)
const files = renderPlanFiles(plan);
// or the raw ordered statements (session statements included) when
// transaction context does not matter
const statements = flattenPlanStatements(plan);
```

**`applyPlan` result changes:**

```ts
// before
| { status: "applied"; statements: number; warnings?: string[] }
| { status: "failed"; error: unknown; script: string }

// after
| { status: "applied"; statements: number; units: number; warnings?: string[] }
| { status: "failed"; error: unknown; script: string;
    failedUnitIndex?: number; completedUnits: number }
```

**Behavioral consequences:**

- Multi-unit plans are **not atomic as a whole**: earlier units commit before later units run, and a later failure does not roll back already-committed units (an added enum value cannot be dropped). `applyPlan` reports the failing unit and how many units committed.
- Non-transactional units run without any transaction wrapper.
- Single-unit plans (the common case) still apply as one transaction.

**Plan JSON:** new plans are written as `version: 2` with `units`. Legacy v1 plan files (flat `statements`) are still read and normalized into a single transactional unit — faithful to how v1 executed them — but v2 plan files are not readable by older pg-delta versions.

**New:** unorderable dependency cycles now throw a typed `UnorderableCycleError` (exported) carrying the offending changes in `error.cycle`, instead of a plain `Error` that callers had to string-match. And `pgdelta plan --output-dir <dir>` writes one numbered, transaction-aware SQL file per migration unit.
