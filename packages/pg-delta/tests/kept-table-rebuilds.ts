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

/** `<scenario>:<forward|reverse>` -> why the engine rebuilds a kept table. */
export const KEPT_TABLE_REBUILDS: Readonly<Record<string, string>> = {
  "dependencies-cycles--partitioned-parent-publication-via-root:forward":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--partitioned-parent-publication-via-root:reverse":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--replace-table-drops-fk:forward":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--replace-table-drops-fk:reverse":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--replace-table-rowtype-fn-check:forward":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--replace-table-rowtype-fn-check:reverse":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--replace-table-rowtype-fn-index:forward":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--replace-table-rowtype-fn-index:reverse":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--replace-table-rowtype-fn-kept:forward":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "dependencies-cycles--replace-table-rowtype-fn-kept:reverse":
    "heap<->partitioned conversion has no in-place form; partitionKey is a replace rule",
  "partitioned-table-operations--add-key-column-under-intermediate:reverse":
    "adding/dropping a column that keys a sub-partition under the root recurses into it, so the root is replaced",
  "partitioned-table-operations--drop-subpartition-key-column:forward":
    "DROP COLUMN on the root recurses into a sub-partition keyed on it and Postgres rejects it; the root is replaced",
  "partitioned-table-operations--drop-subpartition-key-column:reverse":
    "DROP COLUMN on the root recurses into a sub-partition keyed on it and Postgres rejects it; the root is replaced",
  "partitioned-table-operations--partition-dependents:forward":
    "partitionBound is a replace rule; in-place ATTACH/DETACH PARTITION is not implemented",
  "partitioned-table-operations--partition-dependents:reverse":
    "partitionBound is a replace rule; in-place ATTACH/DETACH PARTITION is not implemented",
  "partitioned-table-operations--partition-key-column-type-change:forward":
    "retyping a partition key column is a replace rule for the partitioned table",
  "partitioned-table-operations--partition-key-column-type-change:reverse":
    "retyping a partition key column is a replace rule for the partitioned table",
  "partitioned-table-operations--partition-key-expression-column-type-change:forward":
    "retyping a column used only in the partition key expression still replaces the table",
  "partitioned-table-operations--partition-key-expression-column-type-change:reverse":
    "retyping a column used only in the partition key expression still replaces the table",
  "partitioned-table-operations--repartition-key-identity-sequence-hygiene:forward":
    "partition key change is a replace rule",
  "partitioned-table-operations--repartition-key-identity-sequence-hygiene:reverse":
    "partition key change is a replace rule",
  "partitioned-table-operations--repartition-key-keeps-partitions:forward":
    "partition key change is a replace rule; the kept partitions are rebuilt with the parent",
  "partitioned-table-operations--repartition-key-keeps-partitions:reverse":
    "partition key change is a replace rule; the kept partitions are rebuilt with the parent",
  "partitioned-table-operations--subpartition-key-column-type-change:forward":
    "ALTER COLUMN TYPE on the root recurses into a keyed sub-partition and Postgres rejects it; the root is replaced",
  "partitioned-table-operations--subpartition-key-column-type-change:reverse":
    "ALTER COLUMN TYPE on the root recurses into a keyed sub-partition and Postgres rejects it; the root is replaced",
  "publication-operations--membership-survives-table-replace:forward":
    "partition key change is a replace rule; the point is publication membership surviving it",
  "publication-operations--membership-survives-table-replace:reverse":
    "partition key change is a replace rule; the point is publication membership surviving it",
  "table-ops--attach-partition:forward":
    "partitionBound/parentTable are replace rules; in-place ATTACH PARTITION is not implemented",
  "table-ops--attach-partition:reverse":
    "partitionBound/parentTable are replace rules; in-place ATTACH PARTITION is not implemented",
  "table-ops--detach-partition:forward":
    "partitionBound/parentTable are replace rules; in-place DETACH PARTITION is not implemented",
  "table-ops--detach-partition:reverse":
    "partitionBound/parentTable are replace rules; in-place DETACH PARTITION is not implemented",
  "view-operations--rebuild-on-partition-key-replace:forward":
    "partition key change is a replace rule; dependent views are rebuilt around it",
  "view-operations--rebuild-on-partition-key-replace:reverse":
    "partition key change is a replace rule; dependent views are rebuilt around it",
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
  const allowed = Object.hasOwn(KEPT_TABLE_REBUILDS, key);
  if (rebuilt.size > 0 && !allowed) {
    throw new CorpusContractError(
      `[${scenarioName}] ${direction}: plan destroys table(s) that exist in both states: ${[...rebuilt].join(", ")}. ` +
        `Rebuilding a table that exists in both states loses its rows; fix the plan, or add the case ` +
        `"${key}" to the allowlist in tests/kept-table-rebuilds.ts with the reason.`,
    );
  }
  if (rebuilt.size === 0 && allowed) {
    throw new CorpusContractError(
      `[${scenarioName}] ${direction}: "${key}" is in the kept-table rebuild allowlist ` +
        `(tests/kept-table-rebuilds.ts) but the plan no longer destroys a kept table; remove it from the allowlist.`,
    );
  }
}
