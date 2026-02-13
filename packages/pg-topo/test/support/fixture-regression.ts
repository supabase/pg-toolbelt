import { expect } from "bun:test";
import { analyzeAndSort } from "../../src/analyze-and-sort";
import { validateAnalyzeResultWithPostgres } from "./postgres-validation";
import {
  collectStatementsFromRoots,
  createRandomizedSingleFileFixture,
} from "./randomized-input";

type RuntimeEnvelopeOptions = {
  fixtureRoot: string;
  seeds: number[];
  minStatementCount: number;
  initialMigrationSql?: string;
};

export const expectRandomizedRuntimeOutcomeEnvelope = async (
  options: RuntimeEnvelopeOptions,
): Promise<void> => {
  const { fixtureRoot, seeds, minStatementCount, initialMigrationSql } =
    options;
  const sourceStatements = await collectStatementsFromRoots([fixtureRoot]);

  expect(sourceStatements.length).toBeGreaterThan(minStatementCount);

  for (const seed of seeds) {
    const randomized = await createRandomizedSingleFileFixture(
      sourceStatements,
      seed,
      "pg-topo-random-",
    );

    try {
      const result = await analyzeAndSort({
        roots: [randomized.root],
      });
      const validation = await validateAnalyzeResultWithPostgres(result, {
        initialMigrationSql,
      });

      const parseErrors = result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "PARSE_ERROR",
      );
      const discoveryErrors = result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "DISCOVERY_ERROR",
      );
      const cycles = result.diagnostics.filter(
        (diagnostic) => diagnostic.code === "CYCLE_DETECTED",
      );
      const executionErrors = validation.diagnostics.filter(
        (diagnostic) => diagnostic.code === "RUNTIME_EXECUTION_ERROR",
      );

      expect(result.ordered).toHaveLength(sourceStatements.length);
      expect(parseErrors).toHaveLength(0);
      expect(discoveryErrors).toHaveLength(0);
      expect(cycles).toHaveLength(0);
      expect(executionErrors).toHaveLength(0);
    } finally {
      await randomized.cleanup();
    }
  }
};
