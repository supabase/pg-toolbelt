import { escapeIdentifier } from "pg";
import type { Change } from "../change.types.ts";
import type { DiffContext } from "../context.ts";
import type { ResolvedIntegration } from "../integrations/integration.types.ts";
import { AlterEnumAddValue } from "../objects/type/enum/changes/enum.alter.ts";
import type {
  ExecutionBoundaryReason,
  ExecutionEffect,
  MigrationUnit,
  PlannedStatement,
  TransactionMode,
} from "./types.ts";

interface BuildExecutionPlanOptions {
  integration?: ResolvedIntegration;
  role?: string;
}

interface ExecutionPlan {
  units: MigrationUnit[];
  sessionStatements: string[];
  statements: string[];
}

type StatementAnnotation = {
  requiresCommittedEffects: ExecutionEffect[];
  producesCommittedEffects: ExecutionEffect[];
  transactionMode: TransactionMode;
  boundaryReason: ExecutionBoundaryReason;
  unitName: string;
};

type AnnotatedPlannedStatement = PlannedStatement & {
  transactionMode: TransactionMode;
  boundaryReason: ExecutionBoundaryReason;
  unitName: string;
};

type ExecutionAnnotationAdapter = (args: {
  change: Change;
  sql: string;
}) => Partial<StatementAnnotation>;

const executionAnnotationAdapters: ExecutionAnnotationAdapter[] = [
  enumProducerAdapter,
  nonTransactionalSqlAdapter,
];

export function buildExecutionPlan(
  _ctx: DiffContext,
  changes: Change[],
  options: BuildExecutionPlanOptions = {},
): ExecutionPlan {
  const sessionStatements = buildSessionStatements(changes, options);
  const plannedStatements = changes.map((change, index) =>
    planStatement(change, index, options.integration),
  );
  const units = buildMigrationUnits(plannedStatements);

  return {
    units,
    sessionStatements,
    statements: [
      ...sessionStatements,
      ...units.flatMap((unit) => unit.statements.map((stmt) => stmt.sql)),
    ],
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

function hasRoutineChanges(changes: Change[]): boolean {
  return changes.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate",
  );
}

function planStatement(
  change: Change,
  index: number,
  integration?: ResolvedIntegration,
): AnnotatedPlannedStatement {
  const sql = integration?.serialize?.(change) ?? change.serialize();
  const annotation = annotateChange(change, sql);

  return {
    id: `stmt_${String(index + 1).padStart(4, "0")}`,
    sql,
    changeId: change.changeId,
    requiresCommittedEffects: annotation.requiresCommittedEffects,
    producesCommittedEffects: annotation.producesCommittedEffects,
    transactionMode: annotation.transactionMode,
    boundaryReason: annotation.boundaryReason,
    unitName: annotation.unitName,
  };
}

function annotateChange(change: Change, sql: string): StatementAnnotation {
  const annotation: StatementAnnotation = emptyAnnotation();

  for (const adapter of executionAnnotationAdapters) {
    const partial = adapter({ change, sql });
    annotation.requiresCommittedEffects.push(
      ...(partial.requiresCommittedEffects ?? []),
    );
    annotation.producesCommittedEffects.push(
      ...(partial.producesCommittedEffects ?? []),
    );
    annotation.transactionMode =
      partial.transactionMode ?? annotation.transactionMode;
    annotation.boundaryReason =
      partial.boundaryReason ?? annotation.boundaryReason;
    annotation.unitName = partial.unitName ?? annotation.unitName;
  }

  return {
    ...annotation,
    requiresCommittedEffects: uniqueEffects(
      annotation.requiresCommittedEffects,
    ),
    producesCommittedEffects: uniqueEffects(
      annotation.producesCommittedEffects,
    ),
  };
}

function emptyAnnotation(): StatementAnnotation {
  return {
    requiresCommittedEffects: [],
    producesCommittedEffects: [],
    transactionMode: "transactional",
    boundaryReason: "default",
    unitName: "schema_changes",
  };
}

function enumProducerAdapter({
  change,
}: {
  change: Change;
}): Partial<StatementAnnotation> {
  if (!(change instanceof AlterEnumAddValue)) return {};

  return {
    producesCommittedEffects: [
      {
        kind: "enum_value_committed",
        enumType: {
          schema: change.enum.schema,
          name: change.enum.name,
          stableId: change.enum.stableId,
        },
        label: change.newValue,
      },
    ],
  };
}

function nonTransactionalSqlAdapter({
  sql,
}: {
  sql: string;
}): Partial<StatementAnnotation> {
  if (!requiresNoTransaction(sql)) return {};

  return {
    transactionMode: "none",
    boundaryReason: "non_transactional",
    unitName: "non_transactional",
  };
}

function buildMigrationUnits(
  statements: AnnotatedPlannedStatement[],
): MigrationUnit[] {
  const units: MigrationUnit[] = [];
  let current: MigrationUnit | null = null;
  const uncommittedEffects: ExecutionEffect[] = [];

  for (const statement of statements) {
    if (statement.transactionMode === "none") {
      if (current && current.statements.length > 0) {
        units.push(current);
        markEffectsCommitted(uncommittedEffects);
        current = null;
      }
      units.push(
        createUnit(
          units.length + 1,
          statement.unitName,
          statement.boundaryReason,
          statement.transactionMode,
          [toPlannedStatement(statement)],
        ),
      );
      continue;
    }

    current ??= createUnit(units.length + 1, "schema_changes", "default");
    const reason = requiredBoundaryReason(statement, uncommittedEffects);
    if (reason && current.statements.length > 0) {
      units.push(current);
      markEffectsCommitted(uncommittedEffects);
      current = createUnit(units.length + 1, unitName(reason), reason);
    }

    current.statements.push(toPlannedStatement(statement));
    uncommittedEffects.push(...statement.producesCommittedEffects);
  }

  if (current && current.statements.length > 0) {
    units.push(current);
  }

  return units.map((unit, index) => ({
    ...unit,
    id: `unit_${String(index + 1).padStart(3, "0")}`,
  }));
}

function createUnit(
  index: number,
  name: string,
  reason: ExecutionBoundaryReason,
  transactionMode: TransactionMode = "transactional",
  statements: PlannedStatement[] = [],
): MigrationUnit {
  return {
    id: `unit_${String(index).padStart(3, "0")}`,
    name,
    transactionMode,
    reason,
    statements,
  };
}

function requiredBoundaryReason(
  statement: PlannedStatement,
  uncommittedEffects: ExecutionEffect[],
): ExecutionBoundaryReason | null {
  if (
    uncommittedEffects.some(
      (effect) => effect.kind === "enum_value_committed",
    ) &&
    !statement.producesCommittedEffects.some(
      (effect) => effect.kind === "enum_value_committed",
    )
  ) {
    return "enum_value_visibility";
  }

  return null;
}

function unitName(reason: ExecutionBoundaryReason): string {
  switch (reason) {
    case "enum_value_visibility":
      return "after_enum_values";
    case "non_transactional":
      return "non_transactional";
    case "default":
      return "schema_changes";
  }
}

function markEffectsCommitted(effects: ExecutionEffect[]): void {
  effects.splice(0, effects.length);
}

function uniqueEffects<T extends ExecutionEffect>(effects: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const effect of effects) {
    const key = `${effect.kind}:${effect.enumType.stableId}:${effect.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(effect);
  }
  return result;
}

function requiresNoTransaction(sql: string): boolean {
  return splitStatements(stripSqlComments(sql)).some((statement) =>
    NON_TRANSACTIONAL_PATTERNS.some((pattern) => pattern.test(statement)),
  );
}

const NON_TRANSACTIONAL_PATTERNS = [
  /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i,
  /^\s*DROP\s+INDEX\s+CONCURRENTLY\b/i,
  /^\s*REINDEX\b[\s\S]*\bCONCURRENTLY\b/i,
  /^\s*REFRESH\s+MATERIALIZED\s+VIEW\s+CONCURRENTLY\b/i,
  /^\s*ALTER\s+TABLE\b[\s\S]*\bDETACH\s+PARTITION\b[\s\S]*\bCONCURRENTLY\b/i,
];

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n\r]*/g, " ");
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

function toPlannedStatement(
  statement: AnnotatedPlannedStatement,
): PlannedStatement {
  const {
    transactionMode: _transactionMode,
    boundaryReason: _boundaryReason,
    unitName: _unitName,
    ...plannedStatement
  } = statement;
  return plannedStatement;
}
