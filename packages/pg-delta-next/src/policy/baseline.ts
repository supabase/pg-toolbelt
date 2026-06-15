/**
 * Baseline subtraction: remove facts present-and-identical in the baseline
 * from a FactBase (target-architecture §3.9, stage-08-policy).
 *
 * "Diff against the platform baseline" = set subtraction before planning.
 * Facts present in the baseline with the same payload hash are dropped from
 * both sides, replacing hand-maintained empty-catalog special cases.
 *
 * Parent-chain preservation: if a fact survives (its hash differs from the
 * baseline or it is new), all its ancestors must also survive so that
 * FactBase construction never encounters a missing parent.
 *
 * Edge pruning: edges whose either endpoint was removed are silently dropped
 * (they become dangling, so FactBase would warn about them; we prune them
 * here instead).
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactBase,
} from "../core/fact.ts";
import { encodeId } from "../core/stable-id.ts";
import { deserializeSnapshot } from "../core/snapshot.ts";

/**
 * Return a new FactBase containing only facts that are NOT present with an
 * identical payload hash in `baseline`.
 *
 * A fact is "identical in the baseline" when:
 *   - encodeId(fact.id) exists in baseline, AND
 *   - baseline.hashOf(fact.id) === fb.hashOf(fact.id)
 *
 * Parent-chain rule: any ancestor of a surviving fact is also kept, even if
 * it would otherwise be subtracted, so that FactBase construction succeeds.
 *
 * Edge rule: only edges whose both endpoints survive are kept.
 */
export function subtractBaseline(fb: FactBase, baseline: FactBase): FactBase {
  const allFacts = fb.facts();

  // Phase 1: mark each fact as "would subtract" (present-and-identical in baseline)
  const wouldSubtract = new Set<string>();
  for (const fact of allFacts) {
    const encoded = encodeId(fact.id);
    if (
      baseline.has(fact.id) &&
      baseline.hashOf(fact.id) === fb.hashOf(fact.id)
    ) {
      wouldSubtract.add(encoded);
    }
  }

  // Phase 2: walk every fact that survives and ensure its parent chain survives
  // Collect surviving encoded ids first (those not in wouldSubtract)
  const surviving = new Set<string>();
  for (const fact of allFacts) {
    const encoded = encodeId(fact.id);
    if (!wouldSubtract.has(encoded)) {
      surviving.add(encoded);
    }
  }

  // For each surviving fact, walk up the parent chain and force-add ancestors
  const toForceKeep = new Set<string>();
  for (const fact of allFacts) {
    const encoded = encodeId(fact.id);
    if (!surviving.has(encoded)) continue;
    // Walk parent chain
    let current = fact.parent;
    while (current !== undefined) {
      const parentEncoded = encodeId(current);
      if (surviving.has(parentEncoded)) break; // already in surviving
      if (toForceKeep.has(parentEncoded)) break; // already force-kept
      toForceKeep.add(parentEncoded);
      const parentFact = fb.get(current);
      current = parentFact?.parent;
    }
  }

  // Final surviving set = surviving ∪ toForceKeep
  const finalSurviving = new Set<string>([...surviving, ...toForceKeep]);

  // Phase 3: collect surviving facts (preserving original order for determinism)
  const keptFacts: Fact[] = [];
  for (const fact of allFacts) {
    if (finalSurviving.has(encodeId(fact.id))) {
      keptFacts.push(fact);
    }
  }

  // Phase 4: collect edges whose both endpoints survive
  const keptEdges: DependencyEdge[] = [];
  for (const edge of fb.edges) {
    const fromEncoded = encodeId(edge.from);
    const toEncoded = encodeId(edge.to);
    if (finalSurviving.has(fromEncoded) && finalSurviving.has(toEncoded)) {
      keptEdges.push(edge);
    }
  }

  return buildFactBase(keptFacts, keptEdges);
}

/**
 * Load a baseline FactBase from a snapshot JSON file at the given path.
 *
 * Uses node:fs (synchronous) to read the file, then deserializes via
 * src/core/snapshot.ts. Throws if the file does not exist or the snapshot
 * digest is corrupt.
 */
export function loadBaseline(path: string): FactBase {
  const json = readFileSync(path, "utf-8");
  return deserializeSnapshot(json).factBase;
}

/** Where committed baseline snapshots live (`src/policy/baselines/`). */
const BASELINE_DIR = fileURLToPath(new URL("./baselines/", import.meta.url));

/**
 * Resolve a policy's declared baseline NAME to its committed snapshot FactBase
 * (review finding 3) — the frontend seam that makes a declared baseline ACTUAL.
 *
 * Convention: `<dir>/<baseline>-<pgMajor>.json`, falling back to
 * `<dir>/<baseline>.json`. Returns `undefined` when the policy declares no
 * baseline.
 *
 * Fail-loud: if the policy DOES declare a baseline but no snapshot is committed,
 * this THROWS rather than returning undefined — a declared baseline must never
 * be silently ignored. (Until the platform baselines are committed — a separate
 * v1 validation item — this is the expected behaviour for a policy that sets
 * `baseline`.)
 */
export function resolveBaseline(
  policy: { id: string; baseline?: string },
  opts: { pgMajor: number; dir?: string },
): FactBase | undefined {
  if (policy.baseline === undefined) return undefined;
  const dir = opts.dir ?? BASELINE_DIR;
  const candidates = [
    join(dir, `${policy.baseline}-${opts.pgMajor}.json`),
    join(dir, `${policy.baseline}.json`),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return loadBaseline(path);
  }
  throw new Error(
    `policy "${policy.id}" declares baseline "${policy.baseline}" but no baseline ` +
      `snapshot is committed (looked for: ${candidates.join(", ")}). ` +
      `Generate and commit it, or remove the baseline from the policy — ` +
      `a declared baseline must never be silently ignored.`,
  );
}
