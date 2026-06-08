import type { MigrationUnit, Plan, SerializedPlan } from "./types.ts";

type PlanLike = Plan | SerializedPlan;

export function normalizePlan(plan: PlanLike): Plan {
  const units = plan.units ?? legacyUnits(plan.statements ?? []);
  const sessionStatements =
    plan.sessionStatements ??
    (plan.statements ?? []).filter((statement) =>
      isSessionStatement(statement),
    );
  const statements = plan.statements ?? [
    ...sessionStatements,
    ...units.flatMap((unit) =>
      unit.statements.map((statement) => statement.sql),
    ),
  ];

  return {
    ...plan,
    units,
    statements,
    sessionStatements:
      sessionStatements.length > 0 ? sessionStatements : plan.sessionStatements,
  };
}

export function planUnits(plan: PlanLike): MigrationUnit[] {
  return normalizePlan(plan).units;
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
      id: "unit_001",
      name: "schema_changes",
      transactionMode: "transactional",
      reason: "default",
      statements: schemaStatements.map((sql, index) => ({
        id: `stmt_${String(index + 1).padStart(4, "0")}`,
        sql,
        requiresCommittedEffects: [],
        producesCommittedEffects: [],
      })),
    },
  ];
}
