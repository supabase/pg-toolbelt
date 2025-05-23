import type { PGClient } from "../types.ts";

import {
  extractSequences,
  type SequenceDefinition,
  serializeSequences,
} from "./sequences.ts";
import {
  extractTableDefinitions,
  serializeTableDefinitions,
  type TableDefinition,
} from "./tables.ts";

export type Definitions = {
  sequences: SequenceDefinition[];
  tables: TableDefinition[];
};

export async function extract(db: PGClient) {
  const sequences = await extractSequences(db);
  const tables = await extractTableDefinitions(db);
  return {
    sequences,
    tables,
  };
}

export function serialize(definitions: Definitions) {
  const statements = [];
  statements.push(serializeSequences(definitions.sequences));
  statements.push(serializeTableDefinitions(definitions.tables));
  return statements.join(";\n\n");
}
