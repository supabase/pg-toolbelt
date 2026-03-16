/**
 * Plan creation - the main entry point for creating migration plans.
 */

import { Effect } from "effect";
import { diffCatalogs } from "../catalog.diff.ts";
import {
  Catalog,
  createEmptyCatalog,
  extractCatalog,
} from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import type {
  CatalogExtractionError,
  ConnectionError,
  ConnectionTimeoutError,
  IntegrationSerializationError,
  InvariantViolationError,
  SortCycleError,
  SslConfigError,
} from "../errors.ts";
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
import { serializeChange } from "../serialize-effect.ts";
import type { DatabaseApi } from "../services/database.ts";
import { DatabaseResolver } from "../services/database-resolver.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import type { PgDependRow } from "../sort/types.ts";
import { quoteIdentifier } from "../sql-identifier.ts";
import { classifyChangesRisk } from "./risk.ts";
import type { CreatePlanOptions, Plan } from "./types.ts";

// ============================================================================
// Plan Creation
// ============================================================================

/**
 * Input for source/target: a postgres connection URL, an existing database
 * adapter, or an already-resolved Catalog (e.g. deserialized from a snapshot
 * file).
 */
export type CatalogInput = string | DatabaseApi | Catalog;

/**
 * Build a plan (and supporting artifacts) from already extracted catalogs.
 */
function buildPlanForCatalogs(
  fromCatalog: Catalog,
  toCatalog: Catalog,
  options: CreatePlanOptions = {},
): Effect.Effect<
  { plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null,
  InvariantViolationError | IntegrationSerializationError | SortCycleError
> {
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
    return Effect.succeed(null);
  }

  return Effect.gen(function* () {
    const sortedChanges = yield* sortChanges(ctx, filteredChanges);
    const plan = yield* buildPlan(
      ctx,
      sortedChanges,
      options,
      filterDSL,
      serializeDSL,
      finalIntegration,
    );

    return { plan, sortedChanges, ctx };
  });
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
): Effect.Effect<
  Plan,
  InvariantViolationError | IntegrationSerializationError
> {
  return Effect.gen(function* () {
    const role = options?.role;
    const statements = yield* generateStatements(changes, {
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
  });
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
): Effect.Effect<
  string[],
  InvariantViolationError | IntegrationSerializationError
> {
  return Effect.gen(function* () {
    const statements: string[] = [];

    if (options?.role) {
      statements.push(`SET ROLE ${quoteIdentifier(options.role)}`);
    }

    if (hasRoutineChanges(changes)) {
      statements.push("SET check_function_bodies = false");
    }

    const serialized = yield* Effect.all(
      changes.map((change) =>
        serializeChange(change, options?.integration?.serialize),
      ),
    );

    statements.push(...serialized);
    return statements;
  });
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

export const createPlan = (
  source: CatalogInput | null,
  target: CatalogInput,
  options: CreatePlanOptions = {},
): Effect.Effect<
  { plan: Plan; sortedChanges: Change[]; ctx: DiffContext } | null,
  | CatalogExtractionError
  | ConnectionError
  | ConnectionTimeoutError
  | IntegrationSerializationError
  | InvariantViolationError
  | SortCycleError
  | SslConfigError
> =>
  Effect.gen(function* () {
    const toCatalog = yield* resolveCatalog(target, "target", options);

    const fromCatalog =
      source !== null
        ? yield* resolveCatalog(source, "source", options)
        : yield* createEmptyCatalog(toCatalog.version, toCatalog.currentUser);

    return yield* buildPlanForCatalogs(fromCatalog, toCatalog, options);
  });

const resolveCatalog = (
  input: CatalogInput,
  label: "source" | "target",
  options: CreatePlanOptions,
): Effect.Effect<
  Catalog,
  | CatalogExtractionError
  | ConnectionError
  | ConnectionTimeoutError
  | SslConfigError
> => {
  if (input instanceof Catalog) {
    return Effect.succeed(input);
  }

  if (typeof input === "string") {
    return Effect.scoped(
      Effect.gen(function* () {
        const databaseResolver = yield* DatabaseResolver;
        const db = yield* databaseResolver.fromConnectionString(input, {
          role: options.role,
          label,
        });
        return yield* extractCatalog(db);
      }),
    );
  }

  if ("withConnection" in input) {
    return extractCatalog(input);
  }
  return extractCatalog(input);
};
