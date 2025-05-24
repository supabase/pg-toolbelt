import { serializeSequenceOperation } from "../objects/sequences/index.ts";
import { serializeTableOperation } from "../objects/tables/serialize/index.ts";
import type { SchemaDiff } from "./types.ts";

export function serializeSchemaDiff(diff: SchemaDiff): string {
  const statements: string[] = [];

  // Handle sequences first (they might be dependencies for tables)
  diff.sequences.forEach((operation) => {
    const sql = serializeSequenceOperation(operation);
    if (sql) statements.push(sql);
  });

  // Then handle tables
  diff.tables.forEach((operation) => {
    const sql = serializeTableOperation(operation);
    if (sql) statements.push(sql);
  });

  return statements.join("\n\n");
}
