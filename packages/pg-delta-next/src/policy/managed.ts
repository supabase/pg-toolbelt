/**
 * Managed-object exclusion (docs/extension-intent.md §4.3, Deliverable A).
 *
 * Objects a stateful extension created operationally — pg_partman child
 * partitions, pgmq `q_*`/`a_*` queue tables — carry a `managedBy` edge
 * (emitted by an extension handler's capture, src/policy/extensions). The
 * extension owns their lifecycle, so they must NOT be diffed as schema: a diff
 * would drop them as drift and destroy data (CLI-1555).
 *
 * Exclusion is at the FACT level (both sides + the proof re-extract), NOT the
 * delta level — a delta-only filter would make the proof drift (the clone
 * keeps the children, `desired` lacks them). Removing them from the fact base
 * keeps the proof honest: the plan you prove == the plan you run == the
 * data-preserving plan (docs §6). This mirrors baseline subtraction
 * (src/policy/baseline.ts).
 *
 * A `managedBy`-tagged fact and its entire descendant subtree (the child
 * table's columns/constraints/indexes) are removed; edges with a removed
 * endpoint are pruned (they would otherwise dangle). Facts with no managedBy
 * provenance — e.g. a user-declared `PARTITION OF` — are untouched, so their
 * intended drops still fire (no false suppression).
 */
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
} from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";

/**
 * Return a new FactBase with every operationally-managed fact removed: a fact
 * carrying an outgoing `managedBy` edge, plus all of its descendants. Edges
 * with a removed endpoint are dropped. If nothing is managed, `fb` is returned
 * unchanged.
 */
export function excludeManaged(fb: FactBase): FactBase {
  const allFacts = fb.facts();

  // managed roots: facts with an outgoing `managedBy` edge
  const managedRoots = new Set<string>();
  for (const fact of allFacts) {
    if (fb.outgoingEdges(fact.id).some((e) => e.kind === "managedBy")) {
      managedRoots.add(encodeId(fact.id));
    }
  }
  if (managedRoots.size === 0) return fb;

  // a fact is removed if it is a managed root, or any ancestor is one
  const removed = new Set<string>();
  const isRemoved = (fact: Fact): boolean => {
    const encoded = encodeId(fact.id);
    if (removed.has(encoded)) return true;
    if (managedRoots.has(encoded)) {
      removed.add(encoded);
      return true;
    }
    let current = fact.parent;
    while (current !== undefined) {
      const key = encodeId(current);
      if (managedRoots.has(key) || removed.has(key)) {
        removed.add(encoded);
        return true;
      }
      current = fb.get(current)?.parent;
    }
    return false;
  };

  const keptFacts: Fact[] = allFacts.filter((f) => !isRemoved(f));
  const survives = new Set(keptFacts.map((f) => encodeId(f.id)));
  const keptEdges: DependencyEdge[] = fb.edges.filter(
    (e) => survives.has(encodeId(e.from)) && survives.has(encodeId(e.to)),
  );

  return buildFactBase(keptFacts, keptEdges, fb.source);
}
