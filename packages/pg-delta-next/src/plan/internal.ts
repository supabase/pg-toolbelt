/**
 * Internal planner stages (Item 7 of docs/archive/hardening-plan.md).
 *
 * These are the cleanly-separable phases of `plan()` — they depend only on
 * explicit inputs plus module imports (encodeId, the rule table), never on
 * `plan()`'s local mutable state. Extracting them shrinks the planner body and
 * makes each phase independently readable and testable, behind the UNCHANGED
 * public `plan()` API. The tightly-coupled core (rename cancellation, action
 * emission with its shared producer/destroyer bookkeeping, drop suppression)
 * stays in `plan()`: it is one cohesive algorithm over shared maps and splitting
 * it would thread state for no real gain.
 *
 * Pure refactor: the corpus + differential prove the plans are state-equivalent.
 */
import type { FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import type { Action, SafetyReport } from "./plan.ts";
import { rulesFor } from "./rules.ts";

/**
 * Build the action dependency graph (edges as `[fromIndex, toIndex]`) and check
 * requirements. Build order comes from the DESIRED state's edges, teardown
 * order from the SOURCE state's edges; a consumer of an id that neither this
 * plan produces nor the target already has is a missing requirement (it throws,
 * stage-5 deliverable 6). Reads only the emitted actions + the producer/
 * destroyer indexes + the two fact bases.
 */
export function buildActionGraph(
  actions: readonly Action[],
  producerOf: ReadonlyMap<string, number>,
  destroyerOf: ReadonlyMap<string, number>,
  source: FactBase,
  desired: FactBase,
): Array<[number, number]> {
  const edges: Array<[number, number]> = [];

  // cache encoded -> StableId for ids we encounter
  const parseKeyCache = new Map<string, StableId>();
  const remember = (id: StableId): string => {
    const key = encodeId(id);
    parseKeyCache.set(key, id);
    return key;
  };

  // alter actions indexed by their primary fact (opts.consumes[0])
  const alterersOf = new Map<string, number[]>();
  actions.forEach((action, index) => {
    if (action.verb !== "alter") return;
    const primary = action.consumes[0];
    if (primary === undefined) return;
    const key = encodeId(primary);
    const list = alterersOf.get(key) ?? [];
    list.push(index);
    alterersOf.set(key, list);
  });

  actions.forEach((action, index) => {
    for (const id of action.releases) {
      const destroyer = destroyerOf.get(remember(id));
      if (destroyer !== undefined && destroyer !== index) {
        edges.push([index, destroyer]);
      }
    }
    for (const id of action.consumes) {
      const key = remember(id);
      const producer = producerOf.get(key);
      if (producer !== undefined && producer !== index)
        edges.push([producer, index]);
      const destroyer = destroyerOf.get(key);
      // consumer-before-destroyer applies only when the id is NOT being
      // re-produced; consumers of a replaced fact use the new one
      if (
        destroyer !== undefined &&
        destroyer !== index &&
        producer === undefined
      ) {
        edges.push([index, destroyer]);
      }
      // the id must exist on the target before apply (source) or be
      // produced by this plan; "it's in the desired state" is not enough —
      // a policy filter can hide the delta that would have created it.
      // Built-in roles (pg_*) and PUBLIC are guaranteed by PostgreSQL
      // itself and never extracted as facts.
      const isBuiltinRole =
        id.kind === "role" &&
        ((id as { name: string }).name.startsWith("pg_") ||
          (id as { name: string }).name === "PUBLIC");
      if (producer === undefined && !source.has(id) && !isBuiltinRole) {
        throw new Error(
          `missing requirement: action "${action.sql}" consumes ${key}, which neither exists on the target nor is produced by this plan${desired.has(id) ? " — a filter may be hiding its creation" : ""}`,
        );
      }
    }
    // build order from the DESIRED state's dependency edges
    const producesKeys = new Set(action.produces.map((id) => encodeId(id)));
    for (const id of action.produces) {
      remember(id);
      if (!desired.has(id)) continue;
      for (const edge of desired.outgoingEdges(id)) {
        const targetKey = remember(edge.to);
        const producer = producerOf.get(targetKey);
        if (producer !== undefined && producer !== index) {
          edges.push([producer, index]);
        } else if (producer === undefined) {
          // the dependency is kept but altered in place: create the dependent
          // against its FINAL state (e.g. a view recreated after an enum's
          // value-set migration). Skip alterers that consume what this action
          // produces — there the alter needs the create first (REPLICA
          // IDENTITY USING a new index).
          for (const alterer of alterersOf.get(targetKey) ?? []) {
            if (alterer === index) continue;
            const altererConsumesProduct = (
              actions[alterer] as Action
            ).consumes.some((c) => producesKeys.has(encodeId(c)));
            if (!altererConsumesProduct) edges.push([alterer, index]);
          }
        }
      }
    }
    // teardown order from the SOURCE state's dependency edges
    const destroysKeys = new Set(action.destroys.map((id) => encodeId(id)));
    for (const id of action.destroys) {
      const key = remember(id);
      // replace: destroy before re-produce. This applies even to ids with no
      // source fact — DROP IDENTITY implicitly destroys the backing sequence
      // (alsoDestroys), which a CREATE SEQUENCE of the same name re-produces
      const reproducer = producerOf.get(key);
      if (reproducer !== undefined && reproducer !== index)
        edges.push([index, reproducer]);
      if (!source.has(id)) continue;
      for (const edge of source.edges) {
        if (encodeId(edge.to) !== key) continue;
        const dependentKey = remember(edge.from);
        const dependentDestroyer = destroyerOf.get(dependentKey);
        if (dependentDestroyer !== undefined && dependentDestroyer !== index) {
          edges.push([dependentDestroyer, index]);
        } else if (dependentDestroyer === undefined && desired.has(edge.from)) {
          if (producerOf.has(key)) continue;
          // the desired state no longer carries this dependency: whatever
          // alters the dependent (e.g. ALTER PUBLICATION … SET delisting a
          // dropped table) releases it — order those alters first
          const stillRequired = desired
            .outgoingEdges(edge.from)
            .some((e) => encodeId(e.to) === key);
          if (!stillRequired) {
            for (const alterer of alterersOf.get(dependentKey) ?? []) {
              if (alterer !== index) edges.push([alterer, index]);
            }
            continue;
          }
          // a surviving fact depends on something this plan destroys, and
          // nothing recreates the dependency: fail loudly (stage-5 deliverable 6)
          throw new Error(
            `missing requirement: ${dependentKey} survives but depends on ${key}, which this plan drops without recreating`,
          );
        }
      }
      // a dependent's teardown precedes in-place alters of its dependencies
      // (drop the view before migrating the enum its definition references);
      // an alterer that releases something this action destroys is the
      // opposite shape — releases ordering wins there
      for (const edge of source.outgoingEdges(id)) {
        const depKey = remember(edge.to);
        if (destroyerOf.has(depKey)) continue;
        for (const alterer of alterersOf.get(depKey) ?? []) {
          if (alterer === index) continue;
          const altererReleasesOurDestroy = (
            actions[alterer] as Action
          ).releases.some((r) => destroysKeys.has(encodeId(r)));
          if (!altererReleasesOurDestroy) edges.push([index, alterer]);
        }
      }
      // child teardown precedes parent teardown
      const fact = source.get(id);
      if (fact?.parent !== undefined) {
        const parentDestroyer = destroyerOf.get(remember(fact.parent));
        if (parentDestroyer !== undefined && parentDestroyer !== index) {
          edges.push([index, parentDestroyer]);
        }
      }
    }
  });

  return edges;
}

/**
 * Deterministic tie-break key for an action at index `i`: drops first
 * (descending kind weight), then creates/alters (ascending weight), then by
 * subject id, then by emission index (zero-padded so "10" sorts after "9" —
 * multi-spec sequences like the enum value-set migration rely on it).
 */
export function actionTieKey(actions: readonly Action[], i: number): string {
  const action = actions[i] as Action;
  const subject =
    action.produces[0] ?? action.destroys[0] ?? action.consumes[0];
  const kind = subject?.kind ?? "zz";
  const weight = (() => {
    try {
      return rulesFor(kind).weight;
    } catch {
      return 99;
    }
  })();
  const phase = action.verb === "drop" ? "0" : "1";
  const w = action.verb === "drop" ? 99 - weight : weight;
  return `${phase}|${String(w).padStart(2, "0")}|${subject ? encodeId(subject) : ""}|${String(i).padStart(6, "0")}`;
}

/**
 * Compaction (§3.6): fold `ADD COLUMN` clauses into their bare `CREATE TABLE`.
 * Safe iff every graph predecessor of the folded action sits at or before the
 * target — i.e. no edge crosses the merge. Purely cosmetic: produces/consumes
 * merge, so ordering semantics and the proof are unchanged. Mutates the target
 * actions in place (as the inline version did) and returns the kept actions.
 */
export function compactColumnFolds(
  orderedActions: readonly Action[],
  order: readonly number[],
  edges: ReadonlyArray<[number, number]>,
  foldHints: ReadonlyArray<{ foldInto: StableId; clause: string } | undefined>,
  acceptsFolds: readonly boolean[],
  positionOf: readonly number[],
): Action[] {
  const predecessorsOf = new Map<number, number[]>();
  for (const [a, b] of edges) {
    const list = predecessorsOf.get(b) ?? [];
    list.push(a);
    predecessorsOf.set(b, list);
  }
  const targetPosOf = new Map<string, number>();
  orderedActions.forEach((action, pos) => {
    for (const id of action.produces) {
      const key = encodeId(id);
      if (!targetPosOf.has(key)) targetPosOf.set(key, pos);
    }
  });
  const foldedPos = new Set<number>();
  const effectivePosOf = new Map<number, number>(); // orig idx -> post-fold pos
  for (let pos = 0; pos < orderedActions.length; pos++) {
    const origIndex = order[pos] as number;
    const hint = foldHints[origIndex];
    if (hint === undefined) continue;
    const action = orderedActions[pos] as Action;
    if (action.newSegmentBefore || action.transactionality !== "transactional")
      continue;
    const targetPos = targetPosOf.get(encodeId(hint.foldInto));
    if (targetPos === undefined || targetPos >= pos) continue;
    const targetOrig = order[targetPos] as number;
    if (!acceptsFolds[targetOrig] || foldedPos.has(targetPos)) continue;
    const target = orderedActions[targetPos] as Action;
    if (target.verb !== "create" || target.newSegmentBefore) continue;
    const crossesEdge = (predecessorsOf.get(origIndex) ?? []).some((p) => {
      const pPos = effectivePosOf.get(p) ?? (positionOf[p] as number);
      return pPos > targetPos;
    });
    if (crossesEdge) continue;
    // fold: splice the clause into the CREATE's column list
    target.sql = target.sql.endsWith("()")
      ? `${target.sql.slice(0, -2)}(${hint.clause})`
      : `${target.sql.slice(0, -1)}, ${hint.clause})`;
    target.produces.push(...action.produces);
    for (const id of action.consumes) {
      if (!target.consumes.some((c) => encodeId(c) === encodeId(id)))
        target.consumes.push(id);
    }
    if (action.dataLoss === "destructive") target.dataLoss = "destructive";
    target.rewriteRisk = target.rewriteRisk || action.rewriteRisk;
    foldedPos.add(pos);
    effectivePosOf.set(origIndex, targetPos);
  }
  return foldedPos.size > 0
    ? orderedActions.filter((_, pos) => !foldedPos.has(pos))
    : [...orderedActions];
}

/** Aggregate the per-action safety metadata (§3.7): destructive / rewrite /
 *  non-transactional counts and a histogram of documented lock classes. */
export function computeSafetyReport(actions: readonly Action[]): SafetyReport {
  const safetyReport: SafetyReport = {
    destructiveActions: actions.filter((a) => a.dataLoss === "destructive")
      .length,
    rewriteRiskActions: actions.filter((a) => a.rewriteRisk).length,
    nonTransactionalActions: actions.filter(
      (a) => a.transactionality === "nonTransactional",
    ).length,
    lockClasses: {},
  };
  for (const action of actions) {
    safetyReport.lockClasses[action.lockClass] =
      (safetyReport.lockClasses[action.lockClass] ?? 0) + 1;
  }
  return safetyReport;
}
