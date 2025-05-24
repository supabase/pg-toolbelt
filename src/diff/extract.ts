import { extractSequenceDefinitions } from "../objects/sequences/extract.ts";
import { extractTableDefinitions } from "../objects/tables/extract.ts";
import type { PGClient } from "../types.ts";

export async function extractDefinitions(db: PGClient) {
  const sequences = await extractSequenceDefinitions(db);
  const tables = await extractTableDefinitions(db);

  return {
    sequences,
    tables,
  };
}
