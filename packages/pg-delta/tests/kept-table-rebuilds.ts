/**
 * Corpus guard: a plan must not destroy a table that exists in BOTH states.
 * Rebuilding a kept table loses its rows, and the data-preservation proof does
 * not see it (a destroyed table is not "kept" from the proof's point of view).
 * Every rebuild the engine performs on purpose is pinned in the allowlist below.
 */
import { encodeId } from "../src/core/stable-id.ts";
import type { FactBase } from "../src/core/fact.ts";
import type { Action } from "../src/plan/plan.ts";
import { CorpusContractError } from "./corpus-contract.ts";

/**
 * `<scenario>:<forward|reverse>` -> why the engine rebuilds kept tables, and
 * exactly which ones (sorted encoded stable ids). The set is compared exactly,
 * so a plan that starts rebuilding one more table, or stops rebuilding one,
 * fails the corpus instead of hiding behind an existing entry.
 */
export const KEPT_TABLE_REBUILDS: Readonly<
  Record<string, { reason: string; tables: readonly string[] }>
> = {
  "dependencies-cycles--partitioned-parent-publication-via-root:forward": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:s1.parent"],
  },
  "dependencies-cycles--partitioned-parent-publication-via-root:reverse": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:s1.parent"],
  },
  "dependencies-cycles--replace-table-drops-fk:forward": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:public.child"],
  },
  "dependencies-cycles--replace-table-drops-fk:reverse": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:public.child"],
  },
  "dependencies-cycles--replace-table-rowtype-fn-check:forward": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:public.bookings"],
  },
  "dependencies-cycles--replace-table-rowtype-fn-check:reverse": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:public.bookings"],
  },
  "dependencies-cycles--replace-table-rowtype-fn-index:forward": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:public.bookings"],
  },
  "dependencies-cycles--replace-table-rowtype-fn-index:reverse": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:public.bookings"],
  },
  "dependencies-cycles--replace-table-rowtype-fn-kept:forward": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:public.bookings"],
  },
  "dependencies-cycles--replace-table-rowtype-fn-kept:reverse": {
    reason:
      "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
    tables: ["table:public.bookings"],
  },
  "partitioned-table-operations--add-key-column-under-intermediate:reverse": {
    reason:
      "adding/dropping a column that keys a sub-partition under the root recurses into it, so the root is replaced",
    tables: ["table:test_schema.events", "table:test_schema.events_eu"],
  },
  "partitioned-table-operations--drop-subpartition-key-column:forward": {
    reason:
      "DROP COLUMN on the root recurses into a sub-partition keyed on it and Postgres rejects it; the root is replaced",
    tables: ["table:test_schema.events", "table:test_schema.events_eu"],
  },
  "partitioned-table-operations--drop-subpartition-key-column:reverse": {
    reason:
      "DROP COLUMN on the root recurses into a sub-partition keyed on it and Postgres rejects it; the root is replaced",
    tables: ["table:test_schema.events_eu"],
  },
  "partitioned-table-operations--partition-dependents:forward": {
    reason:
      "partitionBound is a replace rule; in-place ATTACH/DETACH PARTITION is not implemented",
    tables: ["table:app.messages_2024"],
  },
  "partitioned-table-operations--partition-dependents:reverse": {
    reason:
      "partitionBound is a replace rule; in-place ATTACH/DETACH PARTITION is not implemented",
    tables: ["table:app.messages_2024"],
  },
  "partitioned-table-operations--partition-key-column-type-change:forward": {
    reason:
      "retyping a partition key column is a replace rule for the partitioned table",
    tables: ["table:test_schema.messages", "table:test_schema.messages_2024"],
  },
  "partitioned-table-operations--partition-key-column-type-change:reverse": {
    reason:
      "retyping a partition key column is a replace rule for the partitioned table",
    tables: ["table:test_schema.messages", "table:test_schema.messages_2024"],
  },
  "partitioned-table-operations--partition-key-expression-column-type-change:forward":
    {
      reason:
        "retyping a column used only in the partition key expression still replaces the table",
      tables: ["table:test_schema.accounts"],
    },
  "partitioned-table-operations--partition-key-expression-column-type-change:reverse":
    {
      reason:
        "retyping a column used only in the partition key expression still replaces the table",
      tables: ["table:test_schema.accounts"],
    },
  "partitioned-table-operations--repartition-key-identity-sequence-hygiene:forward":
    {
      reason: "partition key change is a replace rule",
      tables: ["table:s1.p1", "table:s1.parent"],
    },
  "partitioned-table-operations--repartition-key-identity-sequence-hygiene:reverse":
    {
      reason: "partition key change is a replace rule",
      tables: ["table:s1.p1", "table:s1.parent"],
    },
  "partitioned-table-operations--repartition-key-keeps-partitions:forward": {
    reason:
      "partition key change is a replace rule; the kept partitions are rebuilt with the parent",
    tables: ["table:s1.parent", "table:s2.p1", "table:s2.p2", "table:s2.p3"],
  },
  "partitioned-table-operations--repartition-key-keeps-partitions:reverse": {
    reason:
      "partition key change is a replace rule; the kept partitions are rebuilt with the parent",
    tables: ["table:s1.parent", "table:s2.p1", "table:s2.p2", "table:s2.p3"],
  },
  "partitioned-table-operations--subpartition-key-column-type-change:forward": {
    reason:
      "ALTER COLUMN TYPE on the root recurses into a keyed sub-partition and Postgres rejects it; the root is replaced",
    tables: ["table:test_schema.events", "table:test_schema.events_eu"],
  },
  "partitioned-table-operations--subpartition-key-column-type-change:reverse": {
    reason:
      "ALTER COLUMN TYPE on the root recurses into a keyed sub-partition and Postgres rejects it; the root is replaced",
    tables: ["table:test_schema.events", "table:test_schema.events_eu"],
  },
  "publication-operations--membership-survives-table-replace:forward": {
    reason:
      "partition key change is a replace rule; the point is publication membership surviving it",
    tables: ["table:s1.parent", "table:s2.p1"],
  },
  "publication-operations--membership-survives-table-replace:reverse": {
    reason:
      "partition key change is a replace rule; the point is publication membership surviving it",
    tables: ["table:s1.parent", "table:s2.p1"],
  },
  "table-ops--attach-partition:forward": {
    reason:
      "partitionBound/parentTable are replace rules; in-place ATTACH PARTITION is not implemented",
    tables: ["table:test_schema.events_2025"],
  },
  "table-ops--attach-partition:reverse": {
    reason:
      "partitionBound/parentTable are replace rules; in-place ATTACH PARTITION is not implemented",
    tables: ["table:test_schema.events_2025"],
  },
  "table-ops--detach-partition:forward": {
    reason:
      "partitionBound/parentTable are replace rules; in-place DETACH PARTITION is not implemented",
    tables: ["table:test_schema.events_2025"],
  },
  "table-ops--detach-partition:reverse": {
    reason:
      "partitionBound/parentTable are replace rules; in-place DETACH PARTITION is not implemented",
    tables: ["table:test_schema.events_2025"],
  },
  "view-operations--rebuild-on-partition-key-replace:forward": {
    reason:
      "partition key change is a replace rule; dependent views are rebuilt around it",
    tables: ["table:s1.p1", "table:s1.parent"],
  },
  "view-operations--rebuild-on-partition-key-replace:reverse": {
    reason:
      "partition key change is a replace rule; dependent views are rebuilt around it",
    tables: ["table:s1.p1", "table:s1.parent"],
  },
};

function keptTableIds(source: FactBase, desired: FactBase): Set<string> {
  const kept = new Set<string>();
  for (const fact of source.facts()) {
    if (fact.id.kind !== "table") continue;
    if (desired.has(fact.id)) kept.add(encodeId(fact.id));
  }
  return kept;
}

export function enforceKeptTableRebuilds(
  actions: readonly Action[],
  source: FactBase,
  desired: FactBase,
  scenarioName: string,
  direction: "forward" | "reverse",
): void {
  const key = `${scenarioName}:${direction}`;
  const kept = keptTableIds(source, desired);
  const rebuilt = new Set<string>();
  for (const action of actions) {
    for (const id of action.destroys) {
      const encoded = encodeId(id);
      if (kept.has(encoded)) rebuilt.add(encoded);
    }
  }
  const entry = Object.hasOwn(KEPT_TABLE_REBUILDS, key)
    ? KEPT_TABLE_REBUILDS[key]
    : undefined;
  if (entry === undefined) {
    if (rebuilt.size === 0) return;
    throw new CorpusContractError(
      `[${scenarioName}] ${direction}: plan destroys table(s) that exist in both states: ${[...rebuilt].join(", ")}. ` +
        `Rebuilding a table that exists in both states loses its rows; fix the plan, or add the case ` +
        `"${key}" to the allowlist in tests/kept-table-rebuilds.ts with the reason and the exact tables.`,
    );
  }
  if (rebuilt.size === 0) {
    throw new CorpusContractError(
      `[${scenarioName}] ${direction}: "${key}" is in the kept-table rebuild allowlist ` +
        `(tests/kept-table-rebuilds.ts) but the plan no longer destroys a kept table; remove it from the allowlist.`,
    );
  }
  const recorded = new Set(entry.tables);
  const unexpected = [...rebuilt].filter((id) => !recorded.has(id)).sort();
  const missing = entry.tables.filter((id) => !rebuilt.has(id));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new CorpusContractError(
      `[${scenarioName}] ${direction}: rebuilt kept tables differ from the allowlist entry "${key}" ` +
        `(tests/kept-table-rebuilds.ts). Unexpected: [${unexpected.join(", ")}]. Missing: [${missing.join(", ")}].`,
    );
  }
}
