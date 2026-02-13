import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverSqlFiles } from "../../src/ingest/discover";
import { parseSqlFile } from "../../src/ingest/parse";

type RandomizedFixture = {
  root: string;
  statementCount: number;
  cleanup: () => Promise<void>;
};

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

export const collectStatementsFromRoots = async (
  roots: string[],
): Promise<string[]> => {
  const discovery = await discoverSqlFiles(roots);
  const statements: string[] = [];

  for (const filePath of discovery.files) {
    const parsed = await parseSqlFile(filePath);
    for (const statement of parsed.statements) {
      statements.push(statement.sql);
    }
  }

  return statements;
};

export const createRandomizedSingleFileFixture = async (
  statements: string[],
  seed: number,
  prefix: string = "pg-topo-randomized-",
): Promise<RandomizedFixture> => {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const shuffledStatements = shuffleDeterministic(statements, seed);
  await Bun.write(
    path.join(root, "randomized.sql"),
    `${shuffledStatements.join("\n\n")}\n`,
  );

  return {
    root,
    statementCount: statements.length,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
    },
  };
};
