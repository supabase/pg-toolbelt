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
 * Only objects the target already has are compared. A new object is created
 * from its printout, and the target holds its stable text from then on.
 */
import type { Pool, PoolClient } from "pg";
import { buildApplyPreamble } from "../apply/apply-preamble.ts";
import type { Diagnostic } from "../core/diagnostic.ts";
import { buildFactBase, type Fact, type FactBase } from "../core/fact.ts";
import { canonicalize, type PayloadValue } from "../core/hash.ts";
import { encodeId } from "../core/stable-id.ts";
import { readFactsScoped } from "../extract/scoped-read.ts";
import { plan, type Plan } from "../plan/plan.ts";

/** Payload attributes holding Postgres-deparsed SQL, by fact kind. */
const DEPARSED_ATTRS: Readonly<Record<string, readonly string[]>> = {
  column: ["generatedExpr"],
  constraint: ["def"],
  default: ["expr"],
  domain: ["default"],
  function: ["def"],
  index: ["def"],
  materializedView: ["def"],
  policy: ["usingExpr", "checkExpr"],
  procedure: ["def"],
  publicationRel: ["where"],
  rule: ["def"],
  trigger: ["def"],
  view: ["def"],
};

/** The SQL clause each non-`def` deparsed attribute is written as. */
const CLAUSE_OF: Readonly<Record<string, string>> = {
  checkExpr: "WITH CHECK",
  default: "DEFAULT",
  expr: "DEFAULT",
  generatedExpr: "GENERATED ALWAYS AS",
  usingExpr: "USING",
  where: "WHERE",
};

// Only has to differ from the replayed text so the plan rebuilds the attribute;
// rules render from the desired side, so it never reaches SQL.
const UNSETTLED = "\u0000unsettled";

/** Each nested expansion level costs one replay per side; deeper nesting than
 *  this is not worth more rebuilds. */
const MAX_REPLAYS = 5;

function deparsedAttrs(fact: Fact): string[] {
  const attrs = DEPARSED_ATTRS[fact.id.kind] ?? [];
  // A string-bodied routine's `def` is stored as written.
  if (
    (fact.id.kind === "function" || fact.id.kind === "procedure") &&
    fact.payload["_sqlBody"] !== true
  ) {
    return [];
  }
  return attrs.filter((attr) => typeof fact.payload[attr] === "string");
}

/** Encoded ids a plan creates, rebuilds, or alters in place. */
export function planSubjects(thePlan: Plan): Set<string> {
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
 * re-resolves to a new overload). Otherwise the change is real.
 */
function sameContext(
  current: FactBase,
  desired: FactBase,
  fact: Fact,
  attrs: readonly string[],
): boolean {
  const before = current.get(fact.id)!;
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
  const unchanged = (id: Fact["id"]): boolean =>
    current.has(id) &&
    desired.has(id) &&
    current.hashOf(id) === desired.hashOf(id);
  if (fact.parent !== undefined && !unchanged(fact.parent)) return false;
  // On older servers (seen on PG14/15) a view's rewrite rule records a
  // dependency on the view itself; that edge points at the very text being
  // compared, not at its context.
  const self = encodeId(fact.id);
  const refs = (fb: FactBase): string[] =>
    fb
      .outgoingEdges(fact.id)
      .filter((edge) => edge.kind === "depends")
      .map((edge) => encodeId(edge.to))
      .filter((to) => to !== self)
      .sort();
  const desiredRefs = refs(desired);
  if (refs(current).join("\n") !== desiredRefs.join("\n")) return false;
  return desiredRefs.every((to) => {
    const id = desired.getByEncoded(to)?.id;
    return id !== undefined && unchanged(id);
  });
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
 * Compare, for every object `current` and `desired` both have, the stable forms
 * of their deparsed attributes, and return `desired` with each compared
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
  } = {},
): Promise<SettleDesiredResult> {
  const candidates: Candidate[] = [];
  for (const fact of desired.facts()) {
    if (desired.isReferenceOnly(fact.id)) continue;
    const key = encodeId(fact.id);
    if (options.only !== undefined && !options.only.has(key)) continue;
    const before = current.get(fact.id);
    if (before === undefined) continue;
    const attrs = deparsedAttrs(fact).filter(
      (attr) => before.payload[attr] !== fact.payload[attr],
    );
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
      targetComparable: sameContext(current, desired, fact, attrs),
    });
  }
  if (candidates.length === 0) {
    return { factBase: desired, changed: false, diagnostics: [] };
  }

  const outcomes = new Map<string, Outcome>();
  let client: PoolClient | undefined;
  try {
    client = await desiredPool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path TO 'pg_catalog'");
    let pending = candidates;
    while (pending.length > 0) {
      const replayed = await replayAll(client, desired, pending);
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
      outcome.kind === "same" ? c.target : outcome.desiredStable,
    );
    if (!sameTexts(outcome.desiredStable, c.desired)) {
      diagnostics.push(rewrittenWarning(c, outcome.desiredStable));
    }
    if (outcome.kind === "same" && outcome.viaTarget) {
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

/** Record one replay result; returns the outcome once the candidate is decided. */
function advance(c: Candidate, result: Texts | Error): Outcome | undefined {
  if (result instanceof Error) {
    // The target's text not rebuilding against the desired schema means the two
    // really differ (e.g. it references a column the files dropped).
    return c.side === "target"
      ? { kind: "changed", desiredStable: c.desiredStable! }
      : { kind: "failed", reason: result.message };
  }
  c.replays++;
  if (c.replays > MAX_REPLAYS) {
    return {
      kind: "failed",
      reason: `text still changing after ${MAX_REPLAYS} replays`,
    };
  }
  if (c.side === "desired") {
    if (sameTexts(result, c.target)) {
      return { kind: "same", desiredStable: result, viaTarget: false };
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
  return Object.entries(texts)
    .map(
      ([attr, text]) =>
        `  ${CLAUSE_OF[attr] === undefined ? "" : `${CLAUSE_OF[attr]} `}${text}`,
    )
    .join("\n");
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
