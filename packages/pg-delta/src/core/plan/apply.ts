/**
 * Plan application - execute migration plans against target databases.
 */

import type { Pool, PoolClient } from "pg";
import { diffCatalogs } from "../catalog.diff.ts";
import { extractCatalog } from "../catalog.model.ts";
import type { DiffContext } from "../context.ts";
import { buildPlanScopeFingerprint, hashStableIds } from "../fingerprint.ts";
import { compileFilterDSL } from "../integrations/filter/dsl.ts";
import { createManagedPool, endPool } from "../postgres-config.ts";
import { sortChanges } from "../sort/sort-changes.ts";
import { normalizePlan } from "./normalize.ts";
import { renderPlanSql } from "./render.ts";
import type { MigrationUnit, Plan } from "./types.ts";

type ApplyPlanResult =
  | { status: "invalid_plan"; message: string }
  | { status: "fingerprint_mismatch"; current: string; expected: string }
  | { status: "already_applied" }
  | {
      status: "applied";
      statements: number;
      units: number;
      warnings?: string[];
    }
  | {
      status: "failed";
      error: unknown;
      script: string;
      /** 0-based index of the unit that failed; undefined if a session statement failed. */
      failedUnitIndex?: number;
      /** Number of units fully committed before the failure. */
      completedUnits: number;
    };

interface ApplyPlanOptions {
  verifyPostApply?: boolean;
}

type ConnectionInput = string | Pool;

/**
 * Apply a plan's migration units to a target database with integrity checks.
 * Validates fingerprints before and after application to ensure plan integrity.
 *
 * Units are applied in order on a single session: transactional units inside
 * an explicit BEGIN/COMMIT, non-transactional units without a wrapper. A
 * failure does not roll back units that already committed.
 */
export async function applyPlan(
  plan: Plan,
  source: ConnectionInput,
  target: ConnectionInput,
  options: ApplyPlanOptions = {},
): Promise<ApplyPlanResult> {
  const normalizedPlan = normalizePlan(plan);
  const units = normalizedPlan.units;
  if (units.length === 0) {
    return {
      status: "invalid_plan",
      message: "Plan contains no SQL statements to execute.",
    };
  }

  let currentPool: Pool;
  let desiredPool: Pool;
  let shouldCloseCurrent = false;
  let shouldCloseDesired = false;

  if (typeof source === "string") {
    const managed = await createManagedPool(source, {
      role: normalizedPlan.role,
      label: "source",
    });
    currentPool = managed.pool;
    shouldCloseCurrent = true;
  } else {
    currentPool = source;
  }

  if (typeof target === "string") {
    const managed = await createManagedPool(target, {
      role: normalizedPlan.role,
      label: "target",
    });
    desiredPool = managed.pool;
    shouldCloseDesired = true;
  } else {
    desiredPool = target;
  }

  try {
    // Recompute stableIds and fingerprints from current and desired catalogs
    const [currentCatalog, desiredCatalog] = await Promise.all([
      extractCatalog(currentPool),
      extractCatalog(desiredPool),
    ]);

    const changes = diffCatalogs(currentCatalog, desiredCatalog);
    const ctx: DiffContext = {
      mainCatalog: currentCatalog,
      branchCatalog: desiredCatalog,
    };

    // Apply the same filter that was used to create the plan (if any)
    let filteredChanges = changes;
    if (normalizedPlan.filter) {
      const filterFn = compileFilterDSL(normalizedPlan.filter);
      filteredChanges = filteredChanges.filter((change) => filterFn(change));
    }

    const sortedChanges = sortChanges(ctx, filteredChanges);
    const { hash: fingerprintFrom, stableIds } = buildPlanScopeFingerprint(
      ctx.mainCatalog,
      sortedChanges,
    );
    // We intentionally recompute target fingerprint only after applying.

    // Pre-apply fingerprint validation
    if (fingerprintFrom === normalizedPlan.target.fingerprint) {
      return { status: "already_applied" };
    }

    if (fingerprintFrom !== normalizedPlan.source.fingerprint) {
      return {
        status: "fingerprint_mismatch",
        current: fingerprintFrom,
        expected: normalizedPlan.source.fingerprint,
      };
    }

    const script = renderPlanSql(normalizedPlan);
    let completedUnits = 0;
    let unitStarted = false;

    // A single session for the whole plan: session statements (SET ROLE,
    // SET check_function_bodies) must stay in effect across all units.
    const client = await currentPool.connect();
    try {
      for (const statement of normalizedPlan.sessionStatements) {
        await client.query(statement);
      }
      for (const unit of units) {
        unitStarted = true;
        await applyUnit(client, unit);
        completedUnits++;
      }
    } catch (error) {
      return {
        status: "failed",
        error,
        script,
        failedUnitIndex: unitStarted ? completedUnits : undefined,
        completedUnits,
      };
    } finally {
      client.release();
    }

    const warnings: string[] = [];

    if (options.verifyPostApply !== false) {
      try {
        const updatedCatalog = await extractCatalog(currentPool);
        const updatedFingerprint = hashStableIds(updatedCatalog, stableIds);
        if (updatedFingerprint !== normalizedPlan.target.fingerprint) {
          warnings.push(
            "Post-apply fingerprint does not match the plan target fingerprint.",
          );
        }
      } catch (error) {
        warnings.push(
          `Could not verify post-apply fingerprint: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      status: "applied",
      // Units contain only change statements; session statements are not counted.
      statements: units.reduce((sum, unit) => sum + unit.statements.length, 0),
      units: units.length,
      warnings: warnings.length ? warnings : undefined,
    };
  } finally {
    const closers: Promise<unknown>[] = [];
    if (shouldCloseCurrent) closers.push(endPool(currentPool));
    if (shouldCloseDesired) closers.push(endPool(desiredPool));
    if (closers.length) {
      await Promise.all(closers);
    }
  }
}

async function applyUnit(
  client: PoolClient,
  unit: MigrationUnit,
): Promise<void> {
  if (unit.transactionMode === "transactional") {
    await client.query("BEGIN");
    try {
      for (const statement of unit.statements) {
        await client.query(statement);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
    return;
  }

  for (const statement of unit.statements) {
    await client.query(statement);
  }
}
