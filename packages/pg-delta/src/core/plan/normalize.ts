import type { MigrationUnit, Plan, SerializedPlan } from "./types.ts";

/**
 * Normalize a plan into the v2 shape: `units` + `sessionStatements`.
 *
 * Legacy v1 plans carry a flat `statements` array instead of units. Their
 * leading SET statements become session statements, and the remaining
 * statements become a single transactional unit — faithful to how the v1
 * applier executed them (one multi-statement query, i.e. one implicit
 * transaction).
 */
export function normalizePlan(plan: SerializedPlan): Plan {
  const { statements, ...rest } = plan;
  return {
    ...rest,
    units: plan.units ?? legacyUnits(statements ?? []),
    sessionStatements:
      plan.sessionStatements ??
      (statements ?? []).filter((statement) => isSessionStatement(statement)),
  };
}

function isSessionStatement(statement: string): boolean {
  return /^SET\s+/i.test(statement.trim());
}

function legacyUnits(statements: string[]): MigrationUnit[] {
  const schemaStatements = statements.filter(
    (statement) => !isSessionStatement(statement),
  );
  if (schemaStatements.length === 0) return [];

  return [
    {
      transactionMode: "transactional",
      reason: "default",
      statements: schemaStatements,
    },
  ];
}
