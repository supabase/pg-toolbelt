/**
 * Settle a desired database's deparsed SQL to the text Postgres produces when
 * that SQL is replayed.
 *
 * Deparse is not always a fixed point. A row-wise `(a, b, c) IS DISTINCT FROM
 * (…)` is stored as nested ORs and deparsed as `((A OR B) OR C)`, but replaying
 * that text parses it flat, so a target built from the plan never reproduces
 * the desired text and the object is rebuilt on every run (#510). Every fact
 * whose payload is a deparse is exposed, not just triggers.
 *
 * The desired database (a shadow loaded from SQL files, a corpus fixture) is
 * disposable, so Postgres re-elaborates there: each deparsed attribute that
 * differs from `current` is rebuilt from its own text by an ordinary plan +
 * apply, and the replayed text replaces it in the fact base. A replay can
 * still not be final — a row comparison over nested rows expands one row level
 * per parse — so replay repeats until the text matches `current` or stops
 * changing. Stopping at a match keeps a target built from an earlier, less
 * settled text converged instead of re-emitting it once more. A converged run
 * has no differing text and does no extra work.
 *
 * Only objects `current` already has are rebuilt: that rebuild is the one the
 * plan runs on the target anyway, whereas rebuilding a newly created object in
 * place can hit restrictions its CREATE never meets (an index attached to a
 * partitioned parent, a domain used in a composite column). The target stores
 * a new object's settled text on first apply, so the next run settles it here.
 */
import type { Pool } from "pg";
import { apply } from "../apply/apply.ts";
import type { Diagnostic } from "../core/diagnostic.ts";
import { buildFactBase, type Fact, type FactBase } from "../core/fact.ts";
import type { PayloadValue } from "../core/hash.ts";
import { encodeId } from "../core/stable-id.ts";
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

// Only has to differ from the desired text so the plan rebuilds the attribute;
// rules render from the desired side, so it never reaches SQL.
const UNSETTLED = "\u0000unsettled";

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

export interface SettleDesiredResult {
  factBase: FactBase;
  /** encoded ids whose deparsed text was rebuilt in the desired database */
  settled: string[];
  diagnostics: Diagnostic[];
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

/**
 * One warning per object whose declarative text Postgres rewrote on replay.
 * The rewrite is re-run on every sync until the source spells the stored form,
 * so the warning quotes that form and points at the source, not at applied
 * migrations (rewriting history cannot change what the target stored).
 */
function rewrittenWarnings(
  desired: FactBase,
  settled: FactBase,
  candidates: ReadonlyMap<string, string[]>,
  replaysOf: ReadonlyMap<string, number>,
): Diagnostic[] {
  const warnings: Diagnostic[] = [];
  for (const [key, attrs] of candidates) {
    const before = desired.getByEncoded(key)!;
    const after = settled.getByEncoded(key)!.payload;
    const rewritten = attrs.filter(
      (attr) => after[attr] !== before.payload[attr],
    );
    if (rewritten.length === 0) continue;
    const replays = replaysOf.get(key) ?? 1;
    const stored = rewritten
      .map(
        (attr) =>
          `  ${CLAUSE_OF[attr] === undefined ? "" : `${CLAUSE_OF[attr]} `}${after[attr] as string}`,
      )
      .join("\n");
    warnings.push({
      code: "deparse_rewritten",
      severity: "warning",
      subject: before.id,
      message:
        `Postgres rewrites this definition when it re-reads it, so pg-delta re-ran it ` +
        `${replays} time${replays === 1 ? "" : "s"} in the shadow on this sync to compare it ` +
        `with the target. This repeats on every sync and slows planning. Write it in your ` +
        `schema file the way Postgres stores it:\n${stored}\n` +
        `Don't edit already-applied migrations.`,
    });
  }
  return warnings;
}

/** Each nested row level costs one replay; deeper nesting than this is not
 *  worth an unbounded loop of applies against the desired database. */
const MAX_REPLAYS = 5;

/**
 * Rebuild, in `desiredPool`, every deparsed attribute of `desired` that
 * differs from `current`'s, and return `desired` with those attributes
 * replaced by their replayed text. WRITES to `desiredPool`: only pass a
 * disposable database. On failure the input fact base is returned unchanged
 * with a warning, so settling never blocks a plan.
 */
export async function settleDesired(
  desiredPool: Pool,
  current: FactBase,
  desired: FactBase,
  options: {
    extract: (pool: Pool) => Promise<{ factBase: FactBase }>;
    /** restrict to these encoded ids, e.g. what a managed plan touches */
    only?: ReadonlySet<string>;
  },
): Promise<SettleDesiredResult> {
  const candidates = new Map<string, string[]>();
  for (const fact of desired.facts()) {
    if (desired.isReferenceOnly(fact.id)) continue;
    if (options.only !== undefined && !options.only.has(encodeId(fact.id))) {
      continue;
    }
    const before = current.get(fact.id);
    if (before === undefined) continue;
    const attrs = deparsedAttrs(fact).filter(
      (attr) => before.payload[attr] !== fact.payload[attr],
    );
    if (attrs.length > 0) candidates.set(encodeId(fact.id), attrs);
  }
  if (candidates.size === 0) {
    return { factBase: desired, settled: [], diagnostics: [] };
  }

  const patch = (
    base: FactBase,
    targets: ReadonlyMap<string, string[]>,
    attrValue: (fact: Fact, attr: string) => PayloadValue,
  ): FactBase => {
    const facts = base.facts().map((fact) => {
      const attrs = targets.get(encodeId(fact.id));
      if (attrs === undefined) return fact;
      const payload = { ...fact.payload };
      for (const attr of attrs) payload[attr] = attrValue(fact, attr);
      return { ...fact, payload };
    });
    const rebuilt = buildFactBase(
      facts,
      [...base.edges],
      base.source,
      base.referenceOnly,
    );
    rebuilt.diagnostics.push(...base.diagnostics);
    return rebuilt;
  };

  let settled = desired;
  let pending: ReadonlyMap<string, string[]> = candidates;
  const replaysOf = new Map<string, number>();
  try {
    for (let replays = 0; pending.size > 0; replays++) {
      if (replays === MAX_REPLAYS) {
        throw new Error(`text still changing after ${MAX_REPLAYS} replays`);
      }
      const rebuild = plan(
        patch(settled, pending, () => UNSETTLED),
        settled,
      );
      const report = await apply(rebuild, desiredPool, {
        fingerprintGate: false,
      });
      if (report.status !== "applied") {
        throw new Error(report.error?.message ?? "apply failed");
      }
      const replayed = (await options.extract(desiredPool)).factBase;
      const next = patch(
        settled,
        pending,
        (fact, attr) =>
          replayed.get(fact.id)?.payload[attr] ?? fact.payload[attr],
      );
      const moving = new Map<string, string[]>();
      for (const [key, attrs] of pending) {
        replaysOf.set(key, (replaysOf.get(key) ?? 0) + 1);
        const was = settled.getByEncoded(key)!.payload;
        const now = next.getByEncoded(key)!.payload;
        const target = current.getByEncoded(key)!.payload;
        const left = attrs.filter(
          (attr) => now[attr] !== was[attr] && now[attr] !== target[attr],
        );
        if (left.length > 0) moving.set(key, left);
      }
      settled = next;
      pending = moving;
    }
    return {
      factBase: settled,
      settled: [...candidates.keys()],
      diagnostics: rewrittenWarnings(desired, settled, candidates, replaysOf),
    };
  } catch (error) {
    return {
      factBase: desired,
      settled: [],
      diagnostics: [
        {
          code: "deparse_settle_failed",
          severity: "warning",
          message:
            `could not replay ${candidates.size} deparsed definition(s) in the desired ` +
            `database, so they are compared as first deparsed; a definition Postgres ` +
            `rewrites on replay may be re-emitted on every run: ` +
            (error instanceof Error ? error.message : String(error)),
        },
      ],
    };
  }
}
