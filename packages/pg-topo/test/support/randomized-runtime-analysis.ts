import { analyzeAndSort } from "../../src/analyze-and-sort";
import type { AnalyzeResult } from "../../src/model/types";
import {
  collectStatementsFromRoots,
  createRandomizedSingleFileFixture,
} from "./randomized-input";

type RandomizedRuntimeAnalyzeOptions = {
  roots: string[];
  seed: number;
};

export const analyzeAndSortFromRandomizedStatements = async (
  options: RandomizedRuntimeAnalyzeOptions,
): Promise<AnalyzeResult> => {
  const { roots, seed } = options;
  const statements = await collectStatementsFromRoots(roots);
  const randomized = await createRandomizedSingleFileFixture(
    statements,
    seed,
    "pg-topo-runtime-random-",
  );

  try {
    return await analyzeAndSort({
      roots: [randomized.root],
    });
  } finally {
    await randomized.cleanup();
  }
};
