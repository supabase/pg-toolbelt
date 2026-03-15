import { readFile } from "node:fs/promises";
import { discoverSqlFiles } from "../../src/ingest/discover";
import { parseSqlContent } from "../../src/ingest/parse";
import { runPgTopoEffect } from "./run-effect";

export const collectStatementsFromRoots = async (
  roots: string[],
): Promise<string[]> => {
  const discovery = await runPgTopoEffect(discoverSqlFiles(roots));
  const statements: string[] = [];

  for (const filePath of discovery.files) {
    const content = await readFile(filePath, "utf-8");
    const parsed = await runPgTopoEffect(parseSqlContent(content, filePath));
    for (const statement of parsed.statements) {
      statements.push(statement.sql);
    }
  }

  return statements;
};
