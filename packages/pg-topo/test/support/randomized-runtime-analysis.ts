import { analyzeAndSort } from "../../src/analyze-and-sort.ts";
import type { AnalyzeResult } from "../../src/model/types.ts";
import { collectStatementsFromRoots } from "./randomized-input.ts";
import { runPgTopoEffect } from "./run-effect.ts";

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

type RandomizedRuntimeAnalyzeOptions = {
  roots: string[];
  seed: number;
};

export const analyzeAndSortFromRandomizedStatements = async (
  options: RandomizedRuntimeAnalyzeOptions,
): Promise<AnalyzeResult> => {
  const { roots, seed } = options;
  const statements = await collectStatementsFromRoots(roots);
  const shuffled = shuffleDeterministic(statements, seed);

  return await runPgTopoEffect(analyzeAndSort(shuffled));
};
