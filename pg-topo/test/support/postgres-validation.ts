import { buildGraph } from "../../src/graph/build-graph";
import type { AnalyzeResult, StatementNode } from "../../src/model/types";
import { validateWithPostgres } from "./postgres/postgres-validator";
import type { RuntimeDiagnostic } from "./postgres/postgres-types";

type PostgresValidationOptions = {
  initialMigrationSql?: string;
};

type PostgresValidationResult = {
  diagnostics: RuntimeDiagnostic[];
};

const validateOrderedWithPostgres = async (
  orderedStatements: StatementNode[],
  options: PostgresValidationOptions = {},
): Promise<PostgresValidationResult> => {
  const graphState = buildGraph(orderedStatements);
  const validationResult = await validateWithPostgres(orderedStatements, graphState, {
    initialMigrationSql: options.initialMigrationSql,
  });

  return {
    diagnostics: validationResult.diagnostics,
  };
};

export const validateAnalyzeResultWithPostgres = async (
  analyzeResult: AnalyzeResult,
  options: PostgresValidationOptions = {},
): Promise<PostgresValidationResult> => {
  const fatalCodes = new Set(["PARSE_ERROR", "DISCOVERY_ERROR", "CYCLE_DETECTED"]);
  const hasFatal = analyzeResult.diagnostics.some((d) => fatalCodes.has(d.code));
  if (hasFatal || analyzeResult.ordered.length === 0) {
    return { diagnostics: [] };
  }

  return validateOrderedWithPostgres(analyzeResult.ordered, options);
};
