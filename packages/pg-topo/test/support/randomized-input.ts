import { readFile } from "node:fs/promises";
import { discoverSqlFiles } from "../../src/ingest/discover";
import { parseSqlContent } from "../../src/ingest/parse";

export const collectStatementsFromRoots = async (
  roots: string[],
): Promise<string[]> => {
  const discovery = await discoverSqlFiles(roots);
  const statements: string[] = [];

  for (const filePath of discovery.files) {
    const content = await readFile(filePath, "utf-8");
    const parsed = await parseSqlContent(content, filePath);
    for (const statement of parsed.statements) {
      statements.push(statement.sql);
    }
  }

  return statements;
};
