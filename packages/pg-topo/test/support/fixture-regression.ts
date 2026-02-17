import { expect } from "bun:test";
import { analyzeAndSort } from "../../src/analyze-and-sort";
import { validateAnalyzeResultWithPostgres } from "./postgres-validation";
import { collectStatementsFromRoots } from "./randomized-input";

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
};

const shuffleDeterministic = <T>(items: T[], seed: number): T[] => {
  const random = seededRandom(seed);
  const cloned = [...items];
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    const current = cloned[index];
    cloned[index] = cloned[randomIndex] as T;
    cloned[randomIndex] = current as T;
  }
  return cloned;
};

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
    const shuffled = shuffleDeterministic(sourceStatements, seed);
    const result = await analyzeAndSort(shuffled);
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
  }
};
