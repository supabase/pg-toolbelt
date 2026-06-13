/**
 * Integration-aware extraction (docs/extension-intent.md §2, §4.1).
 *
 * `extractWithHandlers` = core `extract()` (pg_catalog only — stays pure) PLUS
 * the registered extension handlers' captures, merged into ONE fact base under
 * the same snapshot. There is no second pipeline: handler-produced facts/edges
 * flow through the identical diff/graph/proof machinery. "Sidecar" is a
 * production-and-contract boundary (the integration produces these facts, not
 * core), not a separate data structure.
 *
 * Operational objects are tagged with `managedBy` edges here; callers apply
 * `excludeManaged` (src/policy/managed.ts) before diffing AND in the proof
 * re-extract so the comparison stays consistent.
 */
import type { Pool } from "pg";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
  type FactSource,
} from "../../core/fact.ts";
import { extract, type ExtractResult } from "../../extract/extract.ts";
import { excludeManaged } from "../managed.ts";
import type { ExtensionHandler } from "./handler.ts";
import { pgPartmanHandler } from "./pg-partman.ts";

export type { CaptureResult, ExtensionHandler } from "./handler.ts";
export { pgPartmanHandler } from "./pg-partman.ts";

/** The stateful-extension handlers the Supabase integration composes. */
export const SUPABASE_EXTENSION_HANDLERS: readonly ExtensionHandler[] = [
  pgPartmanHandler,
];

/**
 * Core extraction augmented with the given handlers' captures. The returned
 * fact base carries handler-produced facts + `managedBy` edges; it is NOT yet
 * `excludeManaged`-filtered (callers do that symmetrically on both sides).
 */
export async function extractWithHandlers(
  pool: Pool,
  handlers: readonly ExtensionHandler[] = SUPABASE_EXTENSION_HANDLERS,
  options: { source?: FactSource } = {},
): Promise<ExtractResult> {
  const base = await extract(pool, options);
  const extraFacts: Fact[] = [];
  const extraEdges: DependencyEdge[] = [];
  for (const handler of handlers) {
    const { facts, edges } = await handler.capture(pool, base.factBase);
    extraFacts.push(...facts);
    extraEdges.push(...edges);
  }
  if (extraFacts.length === 0 && extraEdges.length === 0) return base;

  const factBase = buildFactBase(
    [...base.factBase.facts(), ...extraFacts],
    [...base.factBase.edges, ...extraEdges],
    base.factBase.source,
  );
  return {
    factBase,
    pgVersion: base.pgVersion,
    diagnostics: [...base.diagnostics, ...factBase.diagnostics],
  };
}

/**
 * Integration extraction for diffing AND for the proof re-extract: core +
 * handlers, then `excludeManaged` so operationally-created objects are gone on
 * BOTH sides and in the proof clone (docs/extension-intent.md §4.3, §6). Use
 * this — not bare `extract` — wherever a managed-extension integration is
 * active, including as `provePlan`'s `reextract`, so the proof stays
 * consistent (the plan you prove == the plan you run == the data-preserving
 * plan).
 */
export async function extractManaged(
  pool: Pool,
  handlers: readonly ExtensionHandler[] = SUPABASE_EXTENSION_HANDLERS,
  options: { source?: FactSource } = {},
): Promise<ExtractResult> {
  const result = await extractWithHandlers(pool, handlers, options);
  return { ...result, factBase: excludeManaged(result.factBase) };
}
