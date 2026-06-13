/**
 * Extension-member exclusion (docs/pg-delta-next-hardening-plan.md, "Item 4b —
 * provenance flip"; target-architecture §3.1 "provenance is data, an edge fact,
 * not an extraction-time filter").
 *
 * Objects an extension OWNS — pgmq `q_*`/`a_*` queue tables, pg_cron's
 * `cron.job`, a contrib's functions/types/operators — are observed at
 * extraction as ordinary facts carrying a `memberOfExtension` edge to the
 * extension. The extension owns their lifecycle, so by default they must NOT be
 * diffed: a diff would try to drop or recreate extension internals.
 *
 * Exclusion is at the FACT level (both sides + the proof re-extract), NOT the
 * delta level — a delta-only filter would make the proof drift (the clone keeps
 * the members, `desired` lacks them). Removing them from the fact base keeps the
 * proof honest: the plan you prove == the plan you run. This is the exact
 * counterpart of `excludeManaged` (src/policy/managed.ts) — same fact-level
 * subtraction, a different provenance edge (`memberOfExtension` vs `managedBy`).
 *
 * A `memberOfExtension`-tagged fact and its entire descendant subtree (a member
 * table's columns/constraints, its ACL/comment satellites carried as children)
 * are removed; edges with a removed endpoint are pruned. Facts with no
 * `memberOfExtension` provenance are untouched, so user objects (including a
 * user-declared object that merely lives in an extension's schema) still diff
 * normally — no false suppression.
 */
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
} from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";

/**
 * Return a new FactBase with every extension-owned fact removed: a fact carrying
 * an outgoing `memberOfExtension` edge, plus all of its descendants. Edges with
 * a removed endpoint are dropped. If nothing is a member, `fb` is returned
 * unchanged.
 */
export function excludeExtensionMembers(fb: FactBase): FactBase {
  const allFacts = fb.facts();

  // member roots: facts with an outgoing `memberOfExtension` edge
  const memberRoots = new Set<string>();
  for (const fact of allFacts) {
    if (fb.outgoingEdges(fact.id).some((e) => e.kind === "memberOfExtension")) {
      memberRoots.add(encodeId(fact.id));
    }
  }
  if (memberRoots.size === 0) return fb;

  // a fact is removed if it is a member root, or any ancestor is one
  const removed = new Set<string>();
  const isRemoved = (fact: Fact): boolean => {
    const encoded = encodeId(fact.id);
    if (removed.has(encoded)) return true;
    if (memberRoots.has(encoded)) {
      removed.add(encoded);
      return true;
    }
    let current = fact.parent;
    while (current !== undefined) {
      const key = encodeId(current);
      if (memberRoots.has(key) || removed.has(key)) {
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
