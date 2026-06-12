/**
 * The planner (target-architecture §3.4–3.6): deltas × rule table → atomic
 * actions → one mixed dependency graph → one deterministic sort.
 */
import { diff, type Delta } from "../core/diff.ts";
import type { Fact, FactBase } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { topoSort } from "./graph.ts";
import { rulesFor, type ActionSpec } from "./rules.ts";

export interface Action {
  sql: string;
  verb: "create" | "alter" | "drop";
  produces: StableId[];
  consumes: StableId[];
  destroys: StableId[];
  transactional: boolean;
  dataLoss: "none" | "destructive";
  rewriteRisk: boolean;
}

export interface Plan {
  formatVersion: 1;
  source: { fingerprint: string };
  target: { fingerprint: string };
  deltas: Delta[];
  actions: Action[];
}

/** Metadata kinds vanish with their parent regardless of parent kind. */
const METADATA_KINDS = new Set(["comment", "acl"]);
/** Containers whose DROP cascades to children (schema/role do NOT cascade). */
const CASCADING_PARENTS = new Set([
  "table",
  "view",
  "materializedView",
  "column",
  "constraint",
  "index",
  "sequence",
  "procedure",
  "trigger",
  "policy",
  "default",
]);

export function plan(source: FactBase, desired: FactBase): Plan {
  const deltas = diff(source, desired);

  const removed = new Map<string, Fact>();
  const added = new Map<string, Fact>();
  const setsByFact = new Map<string, Extract<Delta, { verb: "set" }>[]>();
  for (const delta of deltas) {
    if (delta.verb === "remove") removed.set(encodeId(delta.fact.id), delta.fact);
    if (delta.verb === "add") added.set(encodeId(delta.fact.id), delta.fact);
    if (delta.verb === "set") {
      const key = encodeId(delta.id);
      const list = setsByFact.get(key) ?? [];
      list.push(delta);
      setsByFact.set(key, list);
    }
  }

  // ── classify set-deltas: in-place alter vs replace ────────────────────
  const replaceIds = new Set<string>();
  for (const [key, sets] of setsByFact) {
    const kind = (desired.get(sets[0]!.id) as Fact).id.kind;
    const rules = rulesFor(kind);
    for (const s of sets) {
      const attrRule = rules.attributes[s.attr];
      if (attrRule === undefined) {
        throw new Error(
          `rule table: kind '${kind}' has no rule for attribute '${s.attr}' (${key}) — extend the rule vocabulary (guardrail 3)`,
        );
      }
      if (attrRule === "replace") replaceIds.add(key);
    }
  }

  // ── suppression: child removals that cascade with an ancestor's drop ──
  // dropRootOf(id) = nearest removed ancestor whose drop action will exist
  const dropRootOf = new Map<string, string>();
  const findDropRoot = (fact: Fact): string => {
    const key = encodeId(fact.id);
    const cached = dropRootOf.get(key);
    if (cached) return cached;
    let root = key;
    const parent = fact.parent;
    if (parent !== undefined) {
      const parentKey = encodeId(parent);
      const parentRemoved = removed.has(parentKey) || replaceIds.has(parentKey);
      const cascades =
        METADATA_KINDS.has(fact.id.kind) || CASCADING_PARENTS.has(parent.kind);
      if (parentRemoved && cascades) {
        root = findDropRoot(
          removed.get(parentKey) ?? (source.get(parent) as Fact),
        );
      }
    }
    dropRootOf.set(key, root);
    return root;
  };
  for (const fact of removed.values()) findDropRoot(fact);

  // ── emit actions ──────────────────────────────────────────────────────
  const actions: Action[] = [];
  const producerOf = new Map<string, number>();
  const destroyerOf = new Map<string, number>();

  const pushAction = (
    verb: Action["verb"],
    spec: ActionSpec,
    opts: { produces?: StableId[]; consumes?: StableId[]; destroys?: StableId[] },
  ): number => {
    const index = actions.length;
    actions.push({
      sql: spec.sql,
      verb,
      produces: opts.produces ?? [],
      consumes: [...(opts.consumes ?? []), ...(spec.consumes ?? [])],
      destroys: opts.destroys ?? [],
      transactional: true,
      dataLoss: spec.dataLoss ?? "none",
      rewriteRisk: spec.rewriteRisk ?? false,
    });
    for (const id of opts.produces ?? []) {
      const key = encodeId(id);
      if (!producerOf.has(key)) producerOf.set(key, index);
    }
    for (const id of opts.destroys ?? []) destroyerOf.set(encodeId(id), index);
    return index;
  };

  const emitCreate = (fact: Fact, base: FactBase): void => {
    const specs = rulesFor(fact.id.kind).create(fact);
    specs.forEach((spec, i) => {
      pushAction("create", spec, {
        produces: i === 0 ? [fact.id] : [],
        consumes: [
          ...(i === 0 ? [] : [fact.id]),
          ...(fact.parent !== undefined ? [fact.parent] : []),
        ],
      });
    });
    void base;
  };

  // creates (skip facts that are descendants of replaced facts — handled below)
  for (const fact of added.values()) emitCreate(fact, desired);

  // drops (suppressed children fold into their root's destroys)
  const destroysByRoot = new Map<string, StableId[]>();
  for (const [key, fact] of removed) {
    const root = dropRootOf.get(key) as string;
    const list = destroysByRoot.get(root) ?? [];
    list.push(fact.id);
    destroysByRoot.set(root, list);
  }
  for (const [key, fact] of removed) {
    if (dropRootOf.get(key) !== key) continue; // suppressed
    if (replaceIds.has(key)) continue; // replace handles its own drop
    const spec = rulesFor(fact.id.kind).drop(fact);
    pushAction("drop", spec, {
      consumes: fact.parent !== undefined ? [fact.parent] : [],
      destroys: destroysByRoot.get(key) ?? [fact.id],
    });
  }

  // replaces: drop old + create new (+ recreate unchanged descendants)
  for (const key of replaceIds) {
    const oldFact = source
      .facts()
      .find((f) => encodeId(f.id) === key) as Fact;
    const newFact = desired
      .facts()
      .find((f) => encodeId(f.id) === key) as Fact;
    // old descendants die with the drop
    const oldDescendants: StableId[] = [oldFact.id];
    const walkOld = (id: StableId): void => {
      for (const child of source.childrenOf(id)) {
        oldDescendants.push(child.id);
        walkOld(child.id);
      }
    };
    walkOld(oldFact.id);
    const dropSpec = rulesFor(oldFact.id.kind).drop(oldFact);
    pushAction("drop", dropSpec, {
      consumes: oldFact.parent !== undefined ? [oldFact.parent] : [],
      destroys: oldDescendants,
    });
    emitCreate(newFact, desired);
    // recreate surviving descendants (unchanged satellites like comments/ACLs)
    const recreate = (id: StableId): void => {
      for (const child of desired.childrenOf(id)) {
        const childKey = encodeId(child.id);
        if (added.has(childKey)) continue; // already created via add delta
        if (setsByFact.has(childKey)) {
          throw new Error(
            `replace of ${key} collides with attribute changes on descendant ${childKey} — needs a delta-set rule`,
          );
        }
        emitCreate(child, desired);
        recreate(child.id);
      }
    };
    recreate(newFact.id);
  }

  // in-place alters
  for (const [key, sets] of setsByFact) {
    if (replaceIds.has(key)) continue;
    const fact = desired.get(sets[0]!.id) as Fact;
    const rules = rulesFor(fact.id.kind);
    for (const s of sets) {
      const attrRule = rules.attributes[s.attr];
      if (attrRule === undefined || attrRule === "replace") continue;
      const spec = attrRule.alter(fact, s.from, s.to);
      pushAction("alter", spec, { consumes: [fact.id] });
    }
  }

  // ── graph edges ───────────────────────────────────────────────────────
  const edges: Array<[number, number]> = [];

  // cache encoded -> StableId for ids we encounter
  const parseKeyCache = new Map<string, StableId>();
  const remember = (id: StableId): string => {
    const key = encodeId(id);
    parseKeyCache.set(key, id);
    return key;
  };

  actions.forEach((action, index) => {
    for (const id of action.consumes) {
      const key = remember(id);
      const producer = producerOf.get(key);
      if (producer !== undefined && producer !== index) edges.push([producer, index]);
      const destroyer = destroyerOf.get(key);
      if (destroyer !== undefined && destroyer !== index) edges.push([index, destroyer]);
      if (producer === undefined && !source.has(id) && !desired.has(id)) {
        throw new Error(
          `missing requirement: action "${action.sql}" consumes ${key}, which neither exists nor is produced by this plan`,
        );
      }
    }
    // build order from the DESIRED state's dependency edges
    for (const id of action.produces) {
      remember(id);
      if (!desired.has(id)) continue;
      for (const edge of desired.outgoingEdges(id)) {
        const targetKey = remember(edge.to);
        const producer = producerOf.get(targetKey);
        if (producer !== undefined && producer !== index) edges.push([producer, index]);
      }
    }
    // teardown order from the SOURCE state's dependency edges
    for (const id of action.destroys) {
      const key = remember(id);
      if (!source.has(id)) continue;
      for (const edge of source.edges) {
        if (encodeId(edge.to) !== key) continue;
        const dependentKey = remember(edge.from);
        const dependentDestroyer = destroyerOf.get(dependentKey);
        if (dependentDestroyer !== undefined && dependentDestroyer !== index) {
          edges.push([dependentDestroyer, index]);
        } else if (dependentDestroyer === undefined && desired.has(edge.from)) {
          // a surviving fact depends on something this plan destroys, and
          // nothing recreates the dependency: fail loudly (stage-5 deliverable 6)
          if (!producerOf.has(key)) {
            throw new Error(
              `missing requirement: ${dependentKey} survives but depends on ${key}, which this plan drops without recreating`,
            );
          }
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
      // replace: destroy before re-produce
      const reproducer = producerOf.get(key);
      if (reproducer !== undefined && reproducer !== index) edges.push([index, reproducer]);
    }
  });

  // ── deterministic order ───────────────────────────────────────────────
  const tieKeyOf = (i: number): string => {
    const action = actions[i] as Action;
    const subject = action.produces[0] ?? action.destroys[0] ?? action.consumes[0];
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
    return `${phase}|${String(w).padStart(2, "0")}|${subject ? encodeId(subject) : ""}|${i}`;
  };

  const order = topoSort(actions.length, edges, tieKeyOf, (i) => (actions[i] as Action).sql);

  return {
    formatVersion: 1,
    source: { fingerprint: source.rootHash },
    target: { fingerprint: desired.rootHash },
    deltas,
    actions: order.map((i) => actions[i] as Action),
  };
}
