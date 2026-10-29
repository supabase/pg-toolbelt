/**
 * Decide whether a deparsed definition really differs between the target and the
 * desired state when Postgres's printout of it is not a fixed point.
 *
 * Postgres expands some expressions into AND/OR trees no SQL text parses back
 * into: a BETWEEN or a row comparison on the left of the same operator stays
 * nested, while reading its printout back flattens it. The stored text therefore
 * depends on how many parse/print round trips an object went through, and the
 * two sides of a declarative plan rarely match: the shadow parses the files
 * once, a target built from pg-delta's migrations twice, a target built from
 * hand-written SQL once, an exported file twice (#510). Comparing printouts then
 * reports a change for objects that mean exactly the same thing.
 *
 * Each side's text is replayed in the desired database until it stops changing,
 * and the two stable texts are compared. Equal: the object is unchanged, and the
 * target's text is kept so the diff sees nothing. Different: a real change,
 * emitted with the stable text so the target does not drift after applying it.
 * A replay rebuilds the object from the text through an ordinary plan, reads it
 * back, and rolls back to a savepoint, so the desired database is never modified
 * and one object failing to rebuild cannot affect another.
 *
 * Only objects the target already has are compared, plus the descendants of a
 * near-miss rename's new name, as if under the old name (see
 * renameCounterparts). Any other new object is created from its printout, and
 * the target holds its stable text from then on.
 */
import type { Pool, PoolClient } from "pg";
import { buildApplyPreamble } from "../apply/apply-preamble.ts";
import type { Diagnostic } from "../core/diagnostic.ts";
import { buildFactBase, type Fact, type FactBase } from "../core/fact.ts";
import { canonicalize, type PayloadValue } from "../core/hash.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { readFactsScoped } from "../extract/scoped-read.ts";
import { connectWithErrorListener } from "../pg-client.ts";
import { plan, type Plan, type PlanOptions } from "../plan/plan.ts";
import type { RenameCandidate } from "../plan/renames.ts";
import { reconstructManagedView } from "../policy/reconstruct.ts";

/** Payload attributes holding Postgres-deparsed SQL, by fact kind. */
const DEPARSED_ATTRS: Readonly<Record<string, readonly string[]>> = {
  column: ["generatedExpr"],
  constraint: ["def"],
  default: ["expr"],
  domain: ["default"],
  function: ["def", "argSignature"],
  index: ["def"],
  materializedView: ["def"],
  policy: ["usingExpr", "checkExpr"],
  procedure: ["def", "argSignature"],
  publicationRel: ["where"],
  rule: ["def"],
  table: ["partitionKey"],
  trigger: ["def"],
  view: ["def"],
};

/** Kinds whose `def` names their table, so a counterpart's target text never
 *  rebuilds under the new name. */
const NAMES_ITS_TABLE = new Set(["index", "rule", "trigger"]);

/** The SQL clause each non-`def` deparsed attribute is written as. */
const CLAUSE_OF: Readonly<Record<string, string>> = {
  checkExpr: "WITH CHECK",
  default: "DEFAULT",
  expr: "DEFAULT",
  generatedExpr: "GENERATED ALWAYS AS",
  partitionKey: "PARTITION BY",
  usingExpr: "USING",
  where: "WHERE",
};

// Only has to differ from the replayed text so the plan rebuilds the attribute;
// rules render from the desired side, so it never reaches SQL.
const UNSETTLED = "\u0000unsettled";

/** Each nested expansion level costs one replay per side; deeper nesting than
 *  this is not worth more rebuilds. */
const MAX_REPLAYS = 5;

/**
 * The deparsed attributes to settle: all of them once any differs, because
 * rebuilding the object for the differing one re-reads the others too (a
 * policy replaced for its WITH CHECK re-parses its USING).
 */
function settledAttrs(before: Fact, fact: Fact): string[] {
  const attrs = (DEPARSED_ATTRS[fact.id.kind] ?? []).filter(
    (attr) => typeof fact.payload[attr] === "string",
  );
  const differs = (attr: string): boolean =>
    before.payload[attr] !== fact.payload[attr];
  // A string-bodied routine stores its body as written; only the parameter
  // defaults in its header are deparsed, and they show in `argSignature`.
  const isStringBodied =
    (fact.id.kind === "function" || fact.id.kind === "procedure") &&
    fact.payload["_sqlBody"] !== true;
  if (isStringBodied ? !differs("argSignature") : !attrs.some(differs)) {
    return [];
  }
  return attrs;
}

/** Encoded ids a plan creates, rebuilds, or alters in place. */
function planSubjects(thePlan: Plan): Set<string> {
  const ids = new Set<string>();
  for (const action of thePlan.actions) {
    for (const id of action.produces) ids.add(encodeId(id));
    // an in-place attribute alter names its fact only as the first consumed id
    const altered =
      action.produces.length === 0 && action.destroys.length === 0
        ? action.consumes[0]
        : undefined;
    if (altered !== undefined) ids.add(encodeId(altered));
  }
  return ids;
}

/** A fact's kind and payload without its deparsed attributes: what must match
 *  for two facts to differ only in spelling. */
function structureOf(fact: Fact): string {
  const deparsed = DEPARSED_ATTRS[fact.id.kind] ?? [];
  const kept = Object.keys(fact.payload)
    .filter((key) => !key.startsWith("_") && !deparsed.includes(key))
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(fact.payload[key])}`);
  return `${fact.id.kind} ${kept.join(",")}`;
}

/** A fact's deparsed texts, for comparing two spellings of one structure. */
function deparsedOf(fact: Fact): string {
  return (DEPARSED_ATTRS[fact.id.kind] ?? [])
    .map((attr) => canonical(fact.payload[attr]))
    .join(",");
}

/** The objects a fact's text reads. On older servers (seen on PG14/15) a
 *  view's rewrite rule records a dependency on the view itself; that edge
 *  points at the very text being compared, not at what it reads. */
function refsOf(fb: FactBase, id: StableId): StableId[] {
  const edges = [...fb.outgoingEdges(id)];
  // A row filter's column dependencies are recorded on the publication, not
  // on its member, and an inherited column resolves to whichever ancestor
  // defines it, so no edge says which member it belongs to: take every
  // column the publication's filters use.
  if (id.kind === "publicationRel") {
    edges.push(
      ...fb
        .outgoingEdges({ kind: "publication", name: id.publication })
        .filter((edge) => edge.to.kind === "column"),
    );
  }
  return edges
    .filter((edge) => edge.kind === "depends")
    .map((edge) => edge.to)
    .filter((to) => encodeId(to) !== encodeId(id));
}

/** The StableId fields naming a table-like parent, which its rename changes. */
const PARENT_FIELDS = new Set(["schema", "table", "target"]);

/**
 * Pair each descendant of `to` with the descendant of `from` under the paired
 * parent that has its kind and own id fields (name, grantee, ...), or else, for
 * one identified by a name alone (Postgres may have generated it from the
 * table's), among those with its structure, the only one with its deparsed
 * text, the only one reading what is already paired, the only one with its
 * name generated alike, or the only one left. Undefined unless every
 * descendant on both sides is paired: only then can settling make the
 * subtrees match.
 */
function pairDescendants(
  current: FactBase,
  desired: FactBase,
  to: StableId,
  from: StableId,
  pairs = new Map<string, Fact>(),
): Map<string, Fact> | undefined {
  const own = (f: Fact): Array<[string, unknown]> =>
    Object.entries(f.id)
      .filter(([field]) => !PARENT_FIELDS.has(field))
      .sort(([x], [y]) => x.localeCompare(y));
  const keyOf = (f: Fact): string => JSON.stringify(own(f));
  // any other id field (a grantee, a provider) is part of what the fact
  // grants or labels, so it pairs only with the same value
  const byName = (f: Fact): boolean => "name" in f.id && own(f).length === 2;
  const wanted = desired.childrenOf(to);
  const olds = current.childrenOf(from);
  const matched: Array<[Fact, Fact]> = [];
  const taken = new Set<Fact>();
  const match = (child: Fact, old: Fact): void => {
    matched.push([child, old]);
    taken.add(old);
  };
  const groups = new Map<string, { wanted: Fact[]; olds: Fact[] }>();
  const groupOf = (f: Fact) => {
    const shape = structureOf(f);
    const group = groups.get(shape) ?? { wanted: [], olds: [] };
    groups.set(shape, group);
    return group;
  };
  for (const child of wanted) {
    const key = keyOf(child);
    const same = olds.find((f) => keyOf(f) === key);
    if (same !== undefined && structureOf(same) === structureOf(child)) {
      match(child, same);
    } else if (same !== undefined) {
      // the same child really changed, which no spelling settles
      return undefined;
    } else if (byName(child)) {
      groupOf(child).wanted.push(child);
    }
  }
  for (const old of olds) {
    if (!taken.has(old) && byName(old)) groupOf(old).olds.push(old);
  }
  // what a fact reads, as the target's ids: two respelled checks still differ
  // in the columns they read
  const usesOf = (fb: FactBase, f: Fact, oldOf?: Map<string, string>) =>
    refsOf(fb, f.id)
      .map((id) => oldOf?.get(encodeId(id)) ?? encodeId(id))
      .sort()
      .join(",");
  // a constraint name Postgres generated from the table's, without the
  // table's name; any other name is the user's own
  const generatedOf = (f: Fact, parent: StableId): string => {
    const name = "name" in f.id ? f.id.name : "";
    const prefix = "name" in parent ? parent.name : "";
    return f.id.kind === "constraint" && name.startsWith(prefix)
      ? name.slice(prefix.length)
      : name;
  };
  for (const group of groups.values()) {
    const matchBy = (
      children: Fact[],
      wantedKey: (f: Fact) => string,
      oldKey: (f: Fact) => string,
    ): Fact[] =>
      children.filter((child) => {
        const key = wantedKey(child);
        const candidates = group.olds.filter(
          (f) => !taken.has(f) && oldKey(f) === key,
        );
        if (
          candidates.length !== 1 ||
          children.filter((f) => wantedKey(f) === key).length !== 1
        ) {
          return true;
        }
        match(child, candidates[0]!);
        return false;
      });
    const oldOf = new Map([
      [encodeId(to), encodeId(from)],
      ...matched.map(
        ([child, old]) => [encodeId(child.id), encodeId(old.id)] as const,
      ),
    ]);
    const byText = matchBy(group.wanted, deparsedOf, deparsedOf);
    const byUses = matchBy(
      byText,
      (f) => usesOf(desired, f, oldOf),
      (f) => usesOf(current, f),
    );
    const left = matchBy(
      byUses,
      (f) => generatedOf(f, to),
      (f) => generatedOf(f, from),
    );
    const leftOld = group.olds.filter((f) => !taken.has(f));
    if (left.length === 1 && leftOld.length === 1) {
      match(left[0]!, leftOld[0]!);
    }
  }
  if (matched.length !== wanted.length || matched.length !== olds.length) {
    return undefined;
  }
  for (const [child, old] of matched) {
    pairs.set(encodeId(child.id), old);
    if (
      pairDescendants(current, desired, child.id, old.id, pairs) === undefined
    ) {
      return undefined;
    }
  }
  return pairs;
}

/** A near-miss rename and the target facts standing for its new name and that
 *  name's descendants, by encoded desired id. */
interface Counterpart {
  rename: string;
  facts: Map<string, Fact>;
}

const renameKey = (from: StableId, to: StableId): string =>
  `${encodeId(from)}>${encodeId(to)}`;

/**
 * For each near-miss rename's new name (same own payload, different subtree),
 * its old names whose subtree pairs with its own, by encoded id. A descendant is
 * settled as if the old name were the new one, so it takes the old text only
 * when both settle to the same text; planSettled keeps that only where the
 * rename then lands.
 */
function renameCounterparts(
  current: FactBase,
  desired: FactBase,
  candidates: readonly RenameCandidate[],
  options: PlanOptions,
): Counterpart[][] {
  // the managed views rename discovery compares
  const view = (fb: FactBase): FactBase =>
    reconstructManagedView(fb, {
      policy: options.policy,
      capability: options.capability,
      baseline: options.baseline,
      scope: options.scope,
      defaultOwner: options.defaultOwner,
    });
  const [managedCurrent, managedDesired] = [view(current), view(desired)];
  // a new name an exact or ambiguous candidate claims is never paired (an
  // old name they claim is never a near-miss)
  const claimed = new Set(
    candidates
      .filter((c) => c.status !== "nearMiss")
      .map((c) => encodeId(c.to)),
  );
  const fromsOf = new Map<string, { to: StableId; froms: StableId[] }>();
  for (const c of candidates) {
    const to = encodeId(c.to);
    if (c.status !== "nearMiss" || claimed.has(to)) continue;
    const entry = fromsOf.get(to) ?? { to: c.to, froms: [] };
    entry.froms.push(c.from);
    fromsOf.set(to, entry);
  }
  return [...fromsOf.values()].map(({ to, froms }) =>
    [...froms]
      .sort((x, y) => encodeId(x).localeCompare(encodeId(y)))
      .flatMap((from) => {
        const root = current.get(from);
        const pairs = pairDescendants(managedCurrent, managedDesired, to, from);
        if (root === undefined || pairs === undefined) return [];
        const facts = new Map([[encodeId(to), root]]);
        for (const [key, old] of pairs) {
          facts.set(key, current.get(old.id) ?? old);
        }
        return [{ rename: renameKey(from, to), facts }];
      }),
  );
}

type Texts = Record<string, string>;

const canonical = (value: PayloadValue | undefined): string =>
  value === undefined ? " absent" : canonicalize(value);

/**
 * Whether the target's text, replayed in the desired database, rebuilds the
 * target's own object. A replay resolves names and types against the desired
 * schema and takes every other attribute from the desired fact, so it only
 * stands for the target's object when nothing around it changed: the same
 * other attributes (a NOT VALID constraint would otherwise come back validated),
 * the same parent, and the same referenced objects (`age > 0` re-resolved
 * against a column that became numeric reads `age > (0)::numeric`, and a call
 * re-resolves to a new overload). Otherwise the change is real. A counterpart's
 * context is read through `counterparts`, as if the target's names were the
 * desired ones.
 */
function sameContext(
  current: FactBase,
  desired: FactBase,
  fact: Fact,
  before: Fact,
  attrs: readonly string[],
  counterparts?: ReadonlyMap<string, Fact>,
): boolean {
  const currentOf = (id: StableId): StableId =>
    counterparts?.get(encodeId(id))?.id ?? id;
  const keys = new Set([
    ...Object.keys(before.payload),
    ...Object.keys(fact.payload),
  ]);
  for (const key of keys) {
    if (key.startsWith("_") || attrs.includes(key)) continue;
    if (canonical(before.payload[key]) !== canonical(fact.payload[key])) {
      return false;
    }
  }
  const unchanged = (id: StableId): boolean =>
    current.has(currentOf(id)) &&
    desired.has(id) &&
    current.hashOf(currentOf(id)) === desired.hashOf(id);
  if (fact.parent !== undefined && !unchanged(fact.parent)) return false;
  const keyOf = (ids: StableId[]): string =>
    ids.map(encodeId).sort().join("\n");
  const desiredRefs = refsOf(desired, fact.id);
  if (keyOf(refsOf(current, before.id)) !== keyOf(desiredRefs.map(currentOf))) {
    return false;
  }
  return desiredRefs.every(unchanged);
}

const sameTexts = (a: Texts, b: Texts): boolean =>
  Object.keys(a).every((attr) => a[attr] === b[attr]);

interface Candidate {
  key: string;
  fact: Fact;
  desired: Texts;
  target: Texts;
  /** which side is being replayed toward its stable text */
  side: "desired" | "target";
  /** the text the next replay rebuilds from */
  next: Texts;
  replays: number;
  /** the desired side's stable text, once known */
  desiredStable?: Texts;
  /** the desired side already replayed to the target's text */
  matched?: true;
  /** whether replaying the target's text in the desired database stands for
   *  the target's own object (see sameContext) */
  targetComparable: boolean;
}

type Outcome =
  | { kind: "same"; desiredStable: Texts; viaTarget: boolean }
  | { kind: "changed"; desiredStable: Texts }
  | { kind: "failed"; reason: string };

export interface SettleDesiredResult {
  factBase: FactBase;
  /** whether any deparsed text in `factBase` differs from `desired` */
  changed: boolean;
  diagnostics: Diagnostic[];
}

/**
 * Compare, for every object `current` and `desired` both have (or that
 * `counterparts` pairs with a target object under another name), the stable
 * forms of their deparsed attributes, and return `desired` with each compared
 * attribute set to the target's text (same meaning) or the desired side's
 * stable text (a real change). Reads and writes `desiredPool` inside a
 * transaction it rolls back. An object whose rebuild fails keeps its text and
 * gets a warning, so settling never blocks a plan.
 */
export async function settleDesired(
  desiredPool: Pool,
  current: FactBase,
  desired: FactBase,
  options: {
    /** restrict to these encoded ids, e.g. what a managed plan touches */
    only?: ReadonlySet<string>;
    /** target facts standing for desired facts the target has under another
     *  name, by encoded desired id (see renameCounterparts) */
    counterparts?: ReadonlyMap<string, Fact>;
    /** counterparts that take their own stable text even where it means the
     *  same as the target's: those whose rename does not land */
    ownText?: ReadonlySet<string>;
  } = {},
): Promise<SettleDesiredResult> {
  const candidates: Candidate[] = [];
  for (const fact of desired.facts()) {
    if (desired.isReferenceOnly(fact.id)) continue;
    const key = encodeId(fact.id);
    if (options.only !== undefined && !options.only.has(key)) continue;
    const own = current.get(fact.id);
    const before = own ?? options.counterparts?.get(key);
    if (before === undefined) continue;
    const attrs = settledAttrs(before, fact);
    if (attrs.length === 0) continue;
    const textsOf = (f: Fact): Texts =>
      Object.fromEntries(
        attrs.map((attr) => [attr, f.payload[attr] as string]),
      );
    candidates.push({
      key,
      fact,
      desired: textsOf(fact),
      target: textsOf(before),
      side: "desired",
      next: textsOf(fact),
      replays: 0,
      targetComparable:
        (own !== undefined ||
          !(NAMES_ITS_TABLE.has(fact.id.kind) || options.ownText?.has(key))) &&
        sameContext(
          current,
          desired,
          fact,
          before,
          attrs,
          own === undefined ? options.counterparts : undefined,
        ),
    });
  }
  if (candidates.length === 0) {
    return { factBase: desired, changed: false, diagnostics: [] };
  }

  const outcomes = new Map<string, Outcome>();
  let client: PoolClient | undefined;
  try {
    client = await connectWithErrorListener(desiredPool);
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO 'pg_catalog'");
    let pending = candidates;
    while (pending.length > 0) {
      // A replay resolves against everything else its batch rebuilds, so the
      // sides are replayed apart: a desired-side text must not resolve against
      // a dependency rebuilt from the target's text.
      const replayed = new Map<string, Texts | Error>();
      for (const side of ["desired", "target"] as const) {
        const batch = pending.filter((c) => c.side === side);
        if (batch.length === 0) continue;
        for (const [key, result] of await replayAll(client, desired, batch)) {
          replayed.set(key, result);
        }
      }
      const still: Candidate[] = [];
      for (const c of pending) {
        const outcome = advance(c, replayed.get(c.key)!);
        if (outcome === undefined) still.push(c);
        else outcomes.set(c.key, outcome);
      }
      pending = still;
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    for (const c of candidates) {
      if (!outcomes.has(c.key)) outcomes.set(c.key, { kind: "failed", reason });
    }
  } finally {
    if (client !== undefined) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  }

  const values = new Map<string, Texts>();
  const diagnostics: Diagnostic[] = [];
  for (const c of candidates) {
    const outcome = outcomes.get(c.key)!;
    if (outcome.kind === "failed") {
      diagnostics.push(failedWarning(c, outcome.reason));
      continue;
    }
    values.set(
      c.key,
      outcome.kind === "same" && options.ownText?.has(c.key) !== true
        ? c.target
        : outcome.desiredStable,
    );
    if (!sameTexts(outcome.desiredStable, c.desired)) {
      diagnostics.push(rewrittenWarning(c, outcome.desiredStable));
    }
    // a counterpart's target object is under another name until the rename lands
    if (
      outcome.kind === "same" &&
      outcome.viaTarget &&
      current.has(c.fact.id)
    ) {
      diagnostics.push(targetUnsettledInfo(c));
    }
  }
  const changed = candidates.some((c) => {
    const value = values.get(c.key);
    return value !== undefined && !sameTexts(value, c.desired);
  });
  return {
    factBase: changed ? patch(desired, values) : desired,
    changed,
    diagnostics,
  };
}

export interface PlanSettledResult {
  plan: Plan;
  /** `desired` with its settled texts */
  desired: FactBase;
  diagnostics: Diagnostic[];
}

/**
 * Plan `current` -> `desired` after settling what a first plan touches,
 * including the descendants of its near-miss renames (see renameCounterparts).
 */
export async function planSettled(
  desiredPool: Pool,
  current: FactBase,
  desired: FactBase,
  options: PlanOptions,
): Promise<PlanSettledResult> {
  // The first plan treats every owner as settable: a spelling-only difference
  // can plan a rebuild that restores an owner the applier cannot become, and
  // that refusal must wait until settling has removed it. The rest of the
  // capability still projects the view.
  const capability = options.capability;
  const missingOwners =
    capability === undefined || capability.isSuperuser
      ? []
      : [
          ...new Set(
            [current, desired].flatMap((fb) =>
              fb.edges.flatMap((edge) =>
                edge.kind === "owner" && edge.to.kind === "role"
                  ? [edge.to.name]
                  : [],
              ),
            ),
          ),
        ].filter((role) => !capability.memberOf.includes(role));
  const probeOptions: PlanOptions =
    capability === undefined || missingOwners.length === 0
      ? options
      : {
          ...options,
          capability: {
            ...capability,
            memberOf: [...capability.memberOf, ...missingOwners],
          },
        };
  const probe = plan(current, desired, probeOptions);
  // Only definitions this plan would emit can carry first-deparse text the
  // target will not reproduce; a converged plan is empty and skips this.
  const touched = planSubjects(probe);
  const choices = renameCounterparts(
    current,
    desired,
    probe.renameCandidates,
    probeOptions,
  );
  const exact = (p: Plan): Set<string> =>
    new Set(
      p.renameCandidates
        .filter((c) => c.status === "unambiguous")
        .map((c) => renameKey(c.from, c.to)),
    );
  // Settling may add a rename, never remove one: a new name settled equal to an
  // exact rename's source makes that rename ambiguous, so settle again without
  // counterparts. An old name's text is kept only where its rename then lands,
  // since otherwise the new name is created from text Postgres does not store:
  // one that misses tries its next old name, then takes its own stable text.
  // Checked under probeOptions, so an unsettable owner is refused only in the
  // plan kept.
  let settle: SettleDesiredResult | undefined;
  let settledPlan: Plan | undefined;
  const picked = choices.map(() => 0);
  while (touched.size > 0) {
    const active = choices.flatMap((olds, i) => {
      const at = picked[i] ?? 0;
      const choice = olds[at] ?? olds[0];
      return choice === undefined
        ? []
        : [{ i, choice, ownText: at >= olds.length }];
    });
    settle = await settleDesired(desiredPool, current, desired, {
      only: touched,
      counterparts: new Map(active.flatMap(({ choice }) => [...choice.facts])),
      ownText: new Set(
        active.flatMap((a) => (a.ownText ? [...a.choice.facts.keys()] : [])),
      ),
    });
    settledPlan = undefined;
    if (active.length === 0) break;
    settledPlan = plan(
      current,
      settle.changed ? settle.factBase : desired,
      probeOptions,
    );
    const kept = exact(settledPlan);
    if ([...exact(probe)].some((rename) => !kept.has(rename))) {
      settle = await settleDesired(desiredPool, current, desired, {
        only: touched,
      });
      settledPlan = undefined;
      break;
    }
    const missed = active.filter(
      (a) => !a.ownText && !kept.has(a.choice.rename),
    );
    if (missed.length === 0) break;
    for (const { i } of missed) picked[i] = (picked[i] ?? 0) + 1;
  }
  const settled = settle?.changed === true ? settle.factBase : desired;
  // a plan made under probeOptions is kept only when those are the caller's own
  const reusable =
    probeOptions === options
      ? settle?.changed === true
        ? settledPlan
        : probe
      : undefined;
  return {
    plan: reusable ?? plan(current, settled, options),
    desired: settled,
    diagnostics: settle?.diagnostics ?? [],
  };
}

/** Record one replay result; returns the outcome once the candidate is decided. */
function advance(c: Candidate, result: Texts | Error): Outcome | undefined {
  if (result instanceof Error) {
    if (c.matched === true) {
      return { kind: "same", desiredStable: c.next, viaTarget: false };
    }
    // The target's text not rebuilding against the desired schema means the two
    // really differ (e.g. it references a column the files dropped).
    return c.side === "target"
      ? { kind: "changed", desiredStable: c.desiredStable! }
      : { kind: "failed", reason: result.message };
  }
  c.replays++;
  if (c.matched === true) {
    // Already equal to the target; replaying on only finds the stable text the
    // warning quotes, since the target may be a replay ahead of the files and
    // still not settled.
    if (sameTexts(result, c.next) || c.replays > MAX_REPLAYS) {
      return { kind: "same", desiredStable: result, viaTarget: false };
    }
    c.next = result;
    return undefined;
  }
  if (c.replays > MAX_REPLAYS) {
    return {
      kind: "failed",
      reason: `text still changing after ${MAX_REPLAYS} replays`,
    };
  }
  if (c.side === "desired") {
    if (sameTexts(result, c.target)) {
      c.matched = true;
      c.next = result;
      return undefined;
    }
    if (!sameTexts(result, c.next)) {
      c.next = result;
      return undefined;
    }
    c.desiredStable = result;
    if (!c.targetComparable) return { kind: "changed", desiredStable: result };
    c.side = "target";
    c.next = c.target;
    c.replays = 0;
    return undefined;
  }
  if (sameTexts(result, c.desiredStable!)) {
    return { kind: "same", desiredStable: c.desiredStable!, viaTarget: true };
  }
  if (sameTexts(result, c.next)) {
    return { kind: "changed", desiredStable: c.desiredStable! };
  }
  c.next = result;
  return undefined;
}

/** Replay every candidate's `next` text in one savepoint, or one savepoint per
 *  candidate when the batch fails, so a failure is pinned to its object. */
async function replayAll(
  client: PoolClient,
  desired: FactBase,
  candidates: readonly Candidate[],
): Promise<Map<string, Texts | Error>> {
  try {
    return await replayInSavepoint(client, desired, candidates);
  } catch (error) {
    if (candidates.length === 1) {
      return new Map([[candidates[0]!.key, asError(error)]]);
    }
    const results = new Map<string, Texts | Error>();
    for (const c of candidates) {
      try {
        results.set(
          c.key,
          (await replayInSavepoint(client, desired, [c])).get(c.key)!,
        );
      } catch (single) {
        results.set(c.key, asError(single));
      }
    }
    return results;
  }
}

async function replayInSavepoint(
  client: PoolClient,
  desired: FactBase,
  candidates: readonly Candidate[],
): Promise<Map<string, Texts | Error>> {
  const next = new Map(candidates.map((c) => [c.key, c.next]));
  const rebuild = plan(
    patch(
      desired,
      new Map(candidates.map((c) => [c.key, sentinelFor(c.next)])),
    ),
    patch(desired, next),
  );
  if (rebuild.actions.some((a) => a.transactionality !== "transactional")) {
    throw new Error(
      "the rebuild needs a statement that cannot run in a transaction",
    );
  }
  await client.query("SAVEPOINT pgdelta_settle");
  try {
    await client.query(
      [
        ...buildApplyPreamble(rebuild, undefined, true),
        ...rebuild.actions.map((a) => a.sql),
      ].join(";\n"),
    );
    const read = await readFactsScoped(
      client,
      candidates.map((c) => c.fact),
    );
    const results = new Map<string, Texts | Error>();
    for (const c of candidates) {
      const fact = read.get(c.key);
      results.set(
        c.key,
        fact === undefined
          ? new Error("the object could not be read back after its rebuild")
          : Object.fromEntries(
              Object.keys(c.next).map((attr) => [
                attr,
                fact.payload[attr] as string,
              ]),
            ),
      );
    }
    return results;
  } finally {
    await client.query(
      "ROLLBACK TO SAVEPOINT pgdelta_settle; RELEASE SAVEPOINT pgdelta_settle",
    );
  }
}

const sentinelFor = (texts: Texts): Texts =>
  Object.fromEntries(Object.keys(texts).map((attr) => [attr, UNSETTLED]));

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

function patch(base: FactBase, texts: ReadonlyMap<string, Texts>): FactBase {
  const facts = base.facts().map((fact) => {
    const replacement = texts.get(encodeId(fact.id));
    return replacement === undefined
      ? fact
      : { ...fact, payload: { ...fact.payload, ...replacement } };
  });
  const rebuilt = buildFactBase(
    facts,
    [...base.edges],
    base.source,
    base.referenceOnly,
  );
  rebuilt.diagnostics.push(...base.diagnostics);
  return rebuilt;
}

function quoted(texts: Texts): string {
  return (
    Object.entries(texts)
      // a routine's `def` already prints its header
      .filter(([attr]) => attr !== "argSignature")
      .map(
        ([attr, text]) =>
          `  ${CLAUSE_OF[attr] === undefined ? "" : `${CLAUSE_OF[attr]} `}${text}`,
      )
      .join("\n")
  );
}

/**
 * The declarative text is a spelling Postgres rewrites, so this object is
 * replayed on every sync until the source spells the stored form. The warning
 * quotes that form and points at the source, not at applied migrations
 * (rewriting history cannot change what the target stored).
 */
function rewrittenWarning(c: Candidate, stable: Texts): Diagnostic {
  return {
    code: "deparse_rewritten",
    severity: "warning",
    subject: c.fact.id,
    message:
      `Postgres rewrites this definition when it re-reads it, so pg-delta replayed it ` +
      `in the shadow on this sync to compare it with the target. This repeats on every ` +
      `sync and slows planning. Write it in your schema file the way Postgres stores it:\n` +
      `${quoted(stable)}\nDon't edit already-applied migrations.`,
  };
}

/** Nothing to fix in the files: the target holds an older spelling, which the
 *  next real change to the object replaces. */
function targetUnsettledInfo(c: Candidate): Diagnostic {
  return {
    code: "deparse_target_unsettled",
    severity: "info",
    subject: c.fact.id,
    message:
      `The target stores this definition in a spelling Postgres rewrites when it re-reads ` +
      `it (for example, it was created by a hand-written migration). pg-delta replayed both ` +
      `sides and they match, so nothing is emitted; the comparison repeats on every sync ` +
      `until the object next changes.`,
  };
}

function failedWarning(c: Candidate, reason: string): Diagnostic {
  return {
    code: "deparse_settle_failed",
    severity: "warning",
    subject: c.fact.id,
    message:
      `could not replay this definition in the desired database, so it is compared as ` +
      `first deparsed; if Postgres rewrites it on replay it may be re-emitted on every run: ${reason}`,
  };
}
