/**
 * Execution planning - group sorted changes into transaction-aware
 * migration units.
 *
 * Execution semantics come from the `nonTransactional` and `commitBoundary`
 * traits declared on the change classes (see `base.change.ts`), never from
 * inspecting rendered SQL.
 */

import { escapeIdentifier } from "pg";
import type { Change } from "../change.types.ts";
import type { ResolvedIntegration } from "../integrations/integration.types.ts";
import type { CommitBoundaryReason } from "../objects/base.change.ts";
import type { ExecutionBoundaryReason, MigrationUnit } from "./types.ts";

interface BuildExecutionPlanOptions {
  integration?: ResolvedIntegration;
  role?: string;
}

interface ExecutionPlan {
  units: MigrationUnit[];
  sessionStatements: string[];
}

export function buildExecutionPlan(
  changes: Change[],
  options: BuildExecutionPlanOptions = {},
): ExecutionPlan {
  return {
    units: buildMigrationUnits(changes, options.integration),
    sessionStatements: buildSessionStatements(changes, options),
  };
}

function buildSessionStatements(
  changes: Change[],
  options: BuildExecutionPlanOptions,
): string[] {
  const statements: string[] = [];

  if (options.role) {
    statements.push(`SET ROLE ${escapeIdentifier(options.role)}`);
  }

  if (hasRoutineChanges(changes)) {
    statements.push("SET check_function_bodies = false");
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

function buildMigrationUnits(
  changes: Change[],
  integration?: ResolvedIntegration,
): MigrationUnit[] {
  const units: MigrationUnit[] = [];
  let current: string[] = [];
  let reason: ExecutionBoundaryReason = "default";
  let pendingBoundary: CommitBoundaryReason | null = null;

  function flush(): void {
    if (current.length === 0) return;
    units.push({
      transactionMode: "transactional",
      reason,
      statements: current,
    });
    current = [];
  }

  for (const change of changes) {
    const sql = integration?.serialize?.(change) ?? change.serialize();
    const boundary = change.commitBoundary;

    if (change.nonTransactional) {
      flush();
      pendingBoundary = null;
      reason = "default";
      units.push({
        transactionMode: "none",
        reason: "non_transactional",
        statements: [sql],
      });
      continue;
    }

    // Only producers of the same boundary kind share a unit; anything else
    // (a different kind or a non-producer) runs after the producers' COMMIT.
    if (pendingBoundary !== null && boundary !== pendingBoundary) {
      flush();
      reason = pendingBoundary;
      pendingBoundary = null;
    }

    current.push(sql);
    if (boundary !== null) {
      pendingBoundary = boundary;
    }
  }

  flush();
  return units;
}
