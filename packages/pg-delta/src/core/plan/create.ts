/**
 * Plan creation - the main entry point for creating migration plans.
 */

import type { Pool } from "pg";
import { escapeIdentifier } from "pg";
import { diffCatalogs } from "../catalog.diff.ts";
import type { Catalog } from "../catalog.model.ts";
import {
  createEmptyCatalog,
  extractCatalog,
} from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import {
  compileFilterDSL,
  type FilterDSL,
} from "../integrations/filter/dsl.ts";
import type { Integration } from "../integrations/integration.types.ts";
import {
  compileSerializeDSL,
  type SerializeDSL,
} from "../integrations/serialize/dsl.ts";
import { createManagedPool, endPool } from "../postgres-config.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import type { PgDependRow } from "../sort/types.ts";
import { classifyChangesRisk } from "./risk.ts";
import type { CreatePlanOptions, Plan } from "./types.ts";

// ============================================================================
// Plan Creation
// ============================================================================

/**
 * Input for source/target: a postgres connection URL, an existing Pool, or
 * an already-resolved Catalog (e.g. deserialized from a snapshot file).
 */
export type CatalogInput = string | Pool | Catalog;

/**
 * Bundle-safe catalog detection: treat input as a resolved Catalog when it has
 * the catalog shape and is not a pg Pool. Deserialized or cross-bundle Catalog
 * instances may fail `instanceof Catalog` but pass this guard.
 */
function isResolvedCatalog(input: CatalogInput): input is Catalog {
  return (
    typeof input === "object" &&
    input !== null &&
    typeof (input as { query?: unknown }).query !== "function" &&
    "version" in input &&
    "currentUser" in input &&
    "depends" in input &&
    "schemas" in input &&
    "tables" in input &&
    "views" in input
  );
}

/**
 * Create a migration plan by comparing two catalog states.
 *
 * Each input can be:
 * - A postgres connection URL (string) -- a pool is created and catalog extracted
 * - An existing pg Pool -- catalog is extracted directly
 * - A Catalog instance -- used as-is (e.g. from a deserialized snapshot)
 *
 * When `source` is `null`, a minimal empty catalog (`createEmptyCatalog`) is
 * used as the baseline. For a more accurate baseline, pass a Catalog
 * deserialized from a snapshot of `template1` or another reference database.
 *
 * @param source - Source catalog input (current state), or null for empty baseline
 * @param target - Target catalog input (desired state)
 * @param options - Optional configuration
 * @returns A Plan if there are changes, null if databases are identical
 */
export async function createPlan(
  source: CatalogInput | null,
  target: CatalogInput,
  options: CreatePlanOptions = {},
): Promise<{ plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null> {
  const resolvePool = async (
    input: string | Pool,
    label: "source" | "target",
  ): Promise<{ pool: Pool; shouldClose: boolean }> => {
    if (typeof input === "string") {
      const managed = await createManagedPool(input, {
        role: options.role,
        label,
      });
      return { pool: managed.pool, shouldClose: true };
    }
    return { pool: input, shouldClose: false };
  };

  /**
   * Resolve a CatalogInput to a Catalog, tracking pools that need cleanup.
   */
  const resolveCatalog = async (
    input: CatalogInput,
    label: "source" | "target",
    pools: Array<{ pool: Pool; shouldClose: boolean }>,
  ): Promise<Catalog> => {
    if (isResolvedCatalog(input)) {
      return input;
    }
    const resolved = await resolvePool(input, label);
    pools.push(resolved);
    return extractCatalog(resolved.pool);
  };

  const pools: Array<{ pool: Pool; shouldClose: boolean }> = [];

  try {
    const toCatalog = await resolveCatalog(target, "target", pools);

    const fromCatalog =
      source !== null
        ? await resolveCatalog(source, "source", pools)
        : await createEmptyCatalog(toCatalog.version, toCatalog.currentUser);

    return buildPlanForCatalogs(fromCatalog, toCatalog, options);
  } finally {
    const closers = pools
      .filter((p) => p.shouldClose)
      .map((p) => endPool(p.pool));
    if (closers.length) await Promise.all(closers);
  }
}

/**
 * Build a plan (and supporting artifacts) from already extracted catalogs.
 */
function buildPlanForCatalogs(
  fromCatalog: Catalog,
  toCatalog: Catalog,
  options: CreatePlanOptions = {},
): { plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null {
  const changes = diffCatalogs(fromCatalog, toCatalog, {
    role: options.role,
    skipDefaultPrivilegeSubtraction: options.skipDefaultPrivilegeSubtraction,
  });

  const filterOption = options.filter;
  const serializeOption = options.serialize;
  const ctx: DiffContext = {
    mainCatalog: fromCatalog,
    branchCatalog: toCatalog,
  };

  // Determine if filter/serialize are DSL or functions, and extract DSL for storage
  const isFilterDSL = filterOption && typeof filterOption !== "function";
  const isSerializeDSL =
    serializeOption && typeof serializeOption !== "function";
  const filterDSL = isFilterDSL ? (filterOption as FilterDSL) : undefined;
  const serializeDSL = isSerializeDSL
    ? (serializeOption as SerializeDSL)
    : undefined;

  // Build final integration: compile DSL if needed, use functions directly otherwise
  let finalIntegration: Integration | undefined;
  if (filterOption || serializeOption) {
    finalIntegration = {
      filter:
        typeof filterOption === "function"
          ? filterOption
          : filterDSL
            ? compileFilterDSL(filterDSL)
            : undefined,
      serialize:
        typeof serializeOption === "function"
          ? serializeOption
          : serializeDSL
            ? compileSerializeDSL(serializeDSL)
            : undefined,
    };
  }

  // Use filter from final integration
  const filterFn = finalIntegration?.filter;

  let filteredChanges = filterFn
    ? changes.filter((change) => filterFn(change))
    : changes;

  // Cascade dependency exclusions: when a change is excluded by the filter,
  // also exclude changes that depend on it (via requires or pg_depend).
  // DSL filters: cascade only if explicitly opted in (cascade: true). Function filters: cascade by default.
  const shouldCascade = isFilterDSL
    ? (filterDSL as Record<string, unknown>)?.cascade === true
    : true;
  if (filterFn && filteredChanges.length < changes.length && shouldCascade) {
    filteredChanges = cascadeExclusions(
      filteredChanges,
      changes,
      toCatalog.depends,
    );
  }

  if (filteredChanges.length === 0) {
    return null;
  }

  const sortedChanges = sortChanges(ctx, filteredChanges);
  const plan = buildPlan(
    ctx,
    sortedChanges,
    options,
    filterDSL,
    serializeDSL,
    finalIntegration,
  );

  return { plan, sortedChanges, ctx };
}

// ============================================================================
// Dependency Cascading
// ============================================================================

/**
 * Cascade exclusions through dependency relationships.
 *
 * When a change is excluded by the filter, any change that depends on it
 * (via explicit `requires` or via catalog `pg_depend`) should also be excluded.
 * This runs as a fixpoint loop, bounded by the total number of changes to
 * guarantee deterministic termination.
 *
 * @param filteredChanges - Changes that passed the initial filter
 * @param allChanges - All changes before filtering
 * @param catalogDepends - Dependency rows from the target catalog (pg_depend)
 * @returns The filtered changes with cascading exclusions applied
 */
function cascadeExclusions(
  filteredChanges: Change[],
  allChanges: Change[],
  catalogDepends: PgDependRow[],
): Change[] {
  // Collect stableIds created by initially-excluded changes
  const filteredSet = new Set(filteredChanges);
  const excludedIds = new Set<string>();
  for (const change of allChanges) {
    if (!filteredSet.has(change)) {
      for (const id of change.creates ?? []) {
        excludedIds.add(id);
      }
    }
  }

  if (excludedIds.size === 0) {
    return filteredChanges;
  }

  // Build reverse dependency map: referenced_stable_id -> Set(dependent_stable_ids)
  const catalogDependents = new Map<string, Set<string>>();
  for (const dep of catalogDepends) {
    const existing = catalogDependents.get(dep.referenced_stable_id);
    if (existing) {
      existing.add(dep.dependent_stable_id);
    } else {
      catalogDependents.set(
        dep.referenced_stable_id,
        new Set([dep.dependent_stable_id]),
      );
    }
  }

  // Fixpoint loop: bounded by total changes to guarantee termination.
  // Each iteration must remove at least one change, otherwise we break.
  let result = filteredChanges;
  for (let i = 0; i < allChanges.length; i++) {
    const beforeLength = result.length;
    result = result.filter((change) => {
      // Check explicit requirements: does this change require an excluded id?
      const requires = change.requires ?? [];
      if (requires.some((dep) => excludedIds.has(dep))) {
        for (const id of change.creates ?? []) {
          excludedIds.add(id);
        }
        return false;
      }

      // Check catalog dependencies: does anything this change creates
      // depend on an excluded id via pg_depend?
      const creates = change.creates ?? [];
      for (const createdId of creates) {
        for (const excludedId of excludedIds) {
          const dependents = catalogDependents.get(excludedId);
          if (dependents?.has(createdId)) {
            for (const id of creates) {
              excludedIds.add(id);
            }
            return false;
          }
        }
      }

      return true;
    });

    // No changes removed this iteration — fixpoint reached
    if (result.length === beforeLength) {
      break;
    }
  }

  return result;
}

// ============================================================================
// Plan Building
// ============================================================================

/**
 * Build a Plan from sorted changes.
 */
function buildPlan(
  ctx: DiffContext,
  changes: Change[],
  options?: CreatePlanOptions,
  filterDSL?: FilterDSL,
  serializeDSL?: SerializeDSL,
  integration?: Integration,
): Plan {
  const role = options?.role;
  const statements = generateStatements(changes, {
    integration,
    role,
  });
  const risk = classifyChangesRisk(changes);

  const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
    ctx.mainCatalog,
    changes,
  );
  const fingerprintTo = hashStableIds(ctx.branchCatalog, stableIds);

  return {
    version: 1,
    source: { fingerprint: fingerprintFrom },
    target: { fingerprint: fingerprintTo },
    statements,
    role,
    filter: filterDSL,
    serialize: serializeDSL,
    risk,
  };
}

/**
 * Generate the individual SQL statements that make up the plan.
 */
function generateStatements(
  changes: Change[],
  options?: {
    integration?: Integration;
    role?: string;
  },
): string[] {
  const statements: string[] = [];

  if (options?.role) {
    statements.push(`SET ROLE ${escapeIdentifier(options.role)}`);
  }

  if (hasRoutineChanges(changes)) {
    statements.push("SET check_function_bodies = false");
  }

  for (const change of changes) {
    const sql = options?.integration?.serialize?.(change) ?? change.serialize();
    statements.push(sql);
  }

  return statements;
}

/**
 * Check if any changes involve routines (procedures or aggregates).
 * Used to determine if we need to disable function body checking.
 */
function hasRoutineChanges(changes: Change[]): boolean {
  return changes.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
}
