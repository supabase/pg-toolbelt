/**
 * Plan creation - the main entry point for creating migration plans.
 */

import type { Pool } from "pg";
import { escapeIdentifier } from "pg";
import { diffCatalogs } from "../catalog.diff.ts";
import type { Catalog } from "../catalog.model.ts";
import { extractCatalog } from "../catalog.model.ts";
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
import { createPool, endPool } from "../postgres-config.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import type { PgDependRow } from "../sort/types.ts";
import { classifyChangesRisk } from "./risk.ts";
import { parseSslConfig } from "./ssl-config.ts";
import type { CreatePlanOptions, Plan } from "./types.ts";

// ============================================================================
// Plan Creation
// ============================================================================

/**
 * Create a migration plan by comparing two databases.
 *
 * @param fromUrl - Source database connection URL (current state)
 * @param toUrl - Target database connection URL (desired state)
 * @param options - Optional configuration
 * @returns A Plan if there are changes, null if databases are identical
 */
type ConnectionInput = string | Pool;

export async function createPlan(
  source: ConnectionInput,
  target: ConnectionInput,
  options: CreatePlanOptions = {},
): Promise<{ plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null> {
  let sourcePool: Pool;
  let targetPool: Pool;
  let shouldCloseSource = false;
  let shouldCloseTarget = false;

  // Suppress expected shutdown errors from idle pool connections (57P01 = admin_shutdown)
  const onError = (err: Error & { code?: string }) => {
    if (err.code !== "57P01") {
      console.error("Pool error:", err);
    }
  };

  if (typeof source === "string") {
    const sslConfig = await parseSslConfig(source, "source");
    sourcePool = createPool(sslConfig.cleanedUrl, {
      ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
      onError,
      onConnect: async (client) => {
        // Force fully qualified names in catalog queries
        await client.query("SET search_path = ''");
        if (options.role) {
          await client.query(`SET ROLE ${escapeIdentifier(options.role)}`);
        }
      },
    });
    shouldCloseSource = true;
  } else {
    sourcePool = source;
  }

  if (typeof target === "string") {
    const sslConfig = await parseSslConfig(target, "target");
    targetPool = createPool(sslConfig.cleanedUrl, {
      ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
      onError,
      onConnect: async (client) => {
        // Force fully qualified names in catalog queries
        await client.query("SET search_path = ''");
        if (options.role) {
          await client.query(`SET ROLE ${escapeIdentifier(options.role)}`);
        }
      },
    });
    shouldCloseTarget = true;
  } else {
    targetPool = target;
  }

  const sourceExtraction = extractCatalog(sourcePool);
  const targetExtraction = extractCatalog(targetPool);

  try {
    const [fromCatalog, toCatalog] = await Promise.all([
      sourceExtraction,
      targetExtraction,
    ]);

    return buildPlanForCatalogs(fromCatalog, toCatalog, options);
  } catch (error) {
    // When one extraction fails, the other may still have in-flight queries.
    // Wait for both to settle before pool cleanup to prevent unhandled
    // rejections from connections being terminated mid-flight.
    await Promise.allSettled([sourceExtraction, targetExtraction]);
    throw error;
  } finally {
    const closers: Promise<unknown>[] = [];
    if (shouldCloseSource) closers.push(endPool(sourcePool));
    if (shouldCloseTarget) closers.push(endPool(targetPool));
    if (closers.length) {
      await Promise.all(closers);
    }
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
  // This is a fixpoint loop bounded by the total number of changes.
  if (filterFn && filteredChanges.length < changes.length) {
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
