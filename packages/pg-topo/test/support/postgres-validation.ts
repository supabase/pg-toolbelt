import type { AnalyzeResult, StatementId } from "../../src/model/types";
import type { RuntimeDiagnostic } from "./postgres/postgres-types";
import { validateWithPostgres } from "./postgres/postgres-validator";

type PostgresValidationOptions = {
  initialMigrationSql?: string;
};

type PostgresValidationResult = {
  diagnostics: RuntimeDiagnostic[];
};

const statementKey = (id: StatementId): string =>
  `${id.filePath}:${id.statementIndex}`;

// Validate the order against the edges the analysis itself produced, not a
// rebuilt graph that could miss what only the analysis knew.
const validateOrderedWithPostgres = async (
  analyzeResult: AnalyzeResult,
  options: PostgresValidationOptions = {},
): Promise<PostgresValidationResult> => {
  const { ordered, graph } = analyzeResult;
  const indexByKey = new Map(
    ordered.map((node, index) => [statementKey(node.id), index]),
  );
  const edges = new Map<number, Set<number>>();
  for (const edge of graph.edges) {
    const fromIndex = indexByKey.get(statementKey(edge.from));
    const toIndex = indexByKey.get(statementKey(edge.to));
    if (fromIndex === undefined || toIndex === undefined) {
      continue;
    }
    edges.set(fromIndex, (edges.get(fromIndex) ?? new Set()).add(toIndex));
  }
  const validationResult = await validateWithPostgres(
    ordered,
    { edges },
    {
      initialMigrationSql: options.initialMigrationSql,
    },
  );

  return {
    diagnostics: validationResult.diagnostics,
  };
};

export const validateAnalyzeResultWithPostgres = async (
  analyzeResult: AnalyzeResult,
  options: PostgresValidationOptions = {},
): Promise<PostgresValidationResult> => {
  const fatalCodes = new Set([
    "PARSE_ERROR",
    "DISCOVERY_ERROR",
    "CYCLE_DETECTED",
  ]);
  const hasFatal = analyzeResult.diagnostics.some((d) =>
    fatalCodes.has(d.code),
  );
  if (hasFatal || analyzeResult.ordered.length === 0) {
    return { diagnostics: [] };
  }

  return validateOrderedWithPostgres(analyzeResult, options);
};
