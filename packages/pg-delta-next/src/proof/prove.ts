/**
 * The proof loop (target-architecture §3.7), as a product API.
 * Materialization (template clone / render-from-fact-base) is the caller's
 * concern; this module owns the checks that turn declared safety metadata
 * into VERIFIED claims:
 *   1. state proof — apply, re-extract, zero drift deltas
 *   2. data preservation — pre-seeded rows survive in tables the plan keeps
 *   3. rewrite observation — a relfilenode that changed under an action
 *      that did NOT declare rewriteRisk is a failed proof (§3.7: rewrite
 *      risk is observed on the clone, not certified by the rule)
 */
import type { Pool } from "pg";
import { apply } from "../apply/apply.ts";
import { diff, type Delta } from "../core/diff.ts";
import type { FactBase } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { extract } from "../extract/extract.ts";
import type { Action, Plan } from "../plan/plan.ts";
import { projectTarget } from "../plan/project.ts";

export interface ProofVerdict {
  ok: boolean;
  applyError?: { actionIndex: number; sql: string; message: string };
  driftDeltas: Delta[];
  /** a kept table whose row count changed — drop+recreate masquerading as
   *  preservation, or an undeclared destructive operation */
  dataViolations: Array<{ table: string; before: number; after: number }>;
  /** a kept table that was physically rewritten (relfilenode changed)
   *  under no action declaring rewriteRisk — the rule under-declared */
  rewriteViolations: Array<{ table: string }>;
}

export interface ProveOptions {
  /** best-effort seed empty kept tables with a synthetic row before
   *  applying, so the data-preservation check has teeth even for scenarios
   *  that ship no seed.sql. Default false (opt-in): enabling it surfaces
   *  populated-table migration hazards, which is a separate audit. */
  autoSeed?: boolean;
  /** how to re-extract the clone after applying. Defaults to the core
   *  `extract`. An integration with extension handlers MUST pass its
   *  managed-aware extractor (e.g. `extractManaged`) so the proof compares the
   *  SAME view of state it diffed — otherwise operationally-managed objects
   *  (pg_partman children, …) reappear as drift (docs/extension-intent.md §6). */
  reextract?: (pool: Pool) => Promise<{ factBase: FactBase }>;
}

interface TableStat {
  rows: number;
  relfilenode: string;
}

const qte = (s: string): string => `"${s.replaceAll('"', '""')}"`;

/** One round trip: every user table's relfilenode + exact row count. */
async function tableStats(pool: Pool): Promise<Map<string, TableStat>> {
  const rels = await pool.query<{
    schema: string;
    name: string;
    relfilenode: string;
  }>(`
    SELECT n.nspname AS schema, c.relname AS name,
           c.relfilenode::text AS relfilenode
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND n.nspname NOT LIKE 'pg\\_%'
    ORDER BY 1, 2`);
  const stats = new Map<string, TableStat>();
  if (rels.rows.length === 0) return stats;
  // a single wide SELECT of all counts avoids the per-table N+1
  const counts = rels.rows
    .map(
      (r, i) =>
        `(SELECT count(*) FROM ${qte(r.schema)}.${qte(r.name)}) AS c${i}`,
    )
    .join(", ");
  const countRow = (await pool.query(`SELECT ${counts}`)).rows[0] as Record<
    string,
    string
  >;
  rels.rows.forEach((r, i) => {
    stats.set(`${r.schema}.${r.name}`, {
      rows: Number(countRow[`c${i}`]),
      relfilenode: r.relfilenode,
    });
  });
  return stats;
}

/** The table relation a fact id belongs to, as "schema.name", or undefined
 *  for ids that are not table-scoped. */
function tableRelationOf(id: StableId): string | undefined {
  if (id.kind === "table" || id.kind === "materializedView") {
    const t = id as { schema: string; name: string };
    return `${t.schema}.${t.name}`;
  }
  const t = id as { schema?: string; table?: string };
  if (typeof t.schema === "string" && typeof t.table === "string") {
    return `${t.schema}.${t.table}`;
  }
  return undefined;
}

function tablesReferencedBy(action: Action): Set<string> {
  const out = new Set<string>();
  for (const id of [
    ...action.produces,
    ...action.consumes,
    ...action.destroys,
  ]) {
    const rel = tableRelationOf(id);
    if (rel !== undefined) out.add(rel);
  }
  return out;
}

async function autoSeedEmptyTables(
  pool: Pool,
  candidates: Iterable<string>,
): Promise<void> {
  for (const table of candidates) {
    const [schema, name] = table.split(".") as [string, string];
    // best-effort: DEFAULT VALUES only succeeds when every column is
    // nullable or defaulted; skip tables it can't satisfy (NOT NULL
    // without default, etc.) rather than fabricating typed values
    try {
      await pool.query(
        `INSERT INTO ${qte(schema)}.${qte(name)} DEFAULT VALUES`,
      );
    } catch {
      // not insertable with defaults — skip (recorded as no coverage)
    }
  }
}

/**
 * Prove a plan against a sacrificial clone of the source. The clone is
 * mutated; never pass a real target.
 */
export async function provePlan(
  thePlan: Plan,
  clonePool: Pool,
  desired: FactBase,
  options: ProveOptions = {},
): Promise<ProofVerdict> {
  // tables the plan tears down (drop or replace) are NOT "kept"; relfilenode
  // and row-count changes on them are expected, not violations
  const recreatedTables = new Set<string>();
  const declaredRewriteTables = new Set<string>();
  for (const action of thePlan.actions) {
    for (const id of action.destroys) {
      const rel = tableRelationOf(id);
      if (
        rel !== undefined &&
        (id.kind === "table" || id.kind === "materializedView")
      )
        recreatedTables.add(rel);
    }
    if (action.rewriteRisk) {
      for (const rel of tablesReferencedBy(action))
        declaredRewriteTables.add(rel);
    }
  }

  if (options.autoSeed) {
    const present = await tableStats(clonePool);
    const empty = [...present]
      .filter(([t, s]) => s.rows === 0 && !recreatedTables.has(t))
      .map(([t]) => t);
    await autoSeedEmptyTables(clonePool, empty);
  }

  const before = await tableStats(clonePool);
  // the proof re-extracts after applying anyway; the fingerprint gate's
  // extra extraction is redundant here (it has its own execution tests)
  const report = await apply(thePlan, clonePool, { fingerprintGate: false });
  if (report.status !== "applied") {
    return {
      ok: false,
      ...(report.error ? { applyError: report.error } : {}),
      driftDeltas: [],
      dataViolations: [],
      rewriteViolations: [],
    };
  }
  const proven = await (options.reextract ?? extract)(clonePool);
  // target the PROJECTED desired: the plan only applies kept deltas, so it
  // converges to `desired` minus the policy-filtered changes (review #2).
  const target = projectTarget(desired, thePlan.filteredDeltas);
  const driftDeltas = diff(proven.factBase, target);
  const after = await tableStats(clonePool);

  const dataViolations: ProofVerdict["dataViolations"] = [];
  const rewriteViolations: ProofVerdict["rewriteViolations"] = [];
  for (const [table, beforeStat] of before) {
    const afterStat = after.get(table);
    if (afterStat === undefined) continue; // table is gone — legitimately dropped
    if (afterStat.rows !== beforeStat.rows) {
      dataViolations.push({
        table,
        before: beforeStat.rows,
        after: afterStat.rows,
      });
    }
    // a kept table (not torn down by the plan) whose physical file changed
    // under no rewriteRisk-declaring action: the rule under-declared
    if (
      afterStat.relfilenode !== beforeStat.relfilenode &&
      !recreatedTables.has(table) &&
      !declaredRewriteTables.has(table)
    ) {
      rewriteViolations.push({ table });
    }
  }

  return {
    ok:
      driftDeltas.length === 0 &&
      dataViolations.length === 0 &&
      rewriteViolations.length === 0,
    driftDeltas,
    dataViolations,
    rewriteViolations,
  };
}
