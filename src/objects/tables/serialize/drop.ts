import type { TableDefinition } from "../types.ts";

export function serializeTableDrop(table: TableDefinition): string {
  return `drop table if exists ${table.schema_name}.${table.table_name};`;
}
