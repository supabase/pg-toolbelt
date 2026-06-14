/**
 * The single fact-level projection primitive behind the managed view
 * (docs/managed-view-architecture.md).
 *
 * The engine diffs a *view* of the managed universe, never raw catalogs, and a
 * view is closed under the proof loop: a fact removed from one side is removed
 * from the other and from the proof re-extract, so `plan == prove == run` holds
 * by construction. Projection is therefore always at the FACT level (both sides
 * + the proof re-extract), never the delta level — a delta-only filter would
 * make the proof drift.
 *
 * `excludeManaged` (managedBy) and `excludeExtensionMembers` (memberOfExtension)
 * are thin wrappers over `excludeByProvenance`; scope and applier-capability
 * projections (later moves) reuse `excludeFactsAndDescendants` with roots chosen
 * a different way.
 */
import {
  buildFactBase,
  type DependencyEdge,
  type EdgeKind,
  type Fact,
  type FactBase,
} from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";

/**
 * Return a new FactBase with `rootIds` and their entire descendant subtrees
 * removed; edges with a removed endpoint are pruned. If `rootIds` is empty, `fb`
 * is returned unchanged (referential identity preserved for cheap no-ops).
 */
export function excludeFactsAndDescendants(
  fb: FactBase,
  rootIds: ReadonlySet<string>,
): FactBase {
  if (rootIds.size === 0) return fb;

  const removed = new Set<string>();
  // a fact is removed if it is a root, or any ancestor is one
  const isRemoved = (fact: Fact): boolean => {
    const encoded = encodeId(fact.id);
    if (removed.has(encoded)) return true;
    if (rootIds.has(encoded)) {
      removed.add(encoded);
      return true;
    }
    let current = fact.parent;
    while (current !== undefined) {
      const key = encodeId(current);
      if (rootIds.has(key) || removed.has(key)) {
        removed.add(encoded);
        return true;
      }
      current = fb.get(current)?.parent;
    }
    return false;
  };

  const keptFacts: Fact[] = fb.facts().filter((f) => !isRemoved(f));
  const survives = new Set(keptFacts.map((f) => encodeId(f.id)));
  const keptEdges: DependencyEdge[] = fb.edges.filter(
    (e) => survives.has(encodeId(e.from)) && survives.has(encodeId(e.to)),
  );
  return buildFactBase(keptFacts, keptEdges, fb.source);
}

/**
 * Project OUT every fact carrying an outgoing edge of `edgeKind`, plus its
 * descendant subtree. Roots are selected by provenance; the removal + edge
 * pruning is `excludeFactsAndDescendants`.
 */
export function excludeByProvenance(
  fb: FactBase,
  edgeKind: EdgeKind,
): FactBase {
  const roots = new Set<string>();
  for (const fact of fb.facts()) {
    if (fb.outgoingEdges(fact.id).some((e) => e.kind === edgeKind)) {
      roots.add(encodeId(fact.id));
    }
  }
  return excludeFactsAndDescendants(fb, roots);
}
