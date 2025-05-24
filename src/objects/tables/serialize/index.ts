import type { DiffOperation } from "../../../diff/types.ts";
import type { TableDefinition } from "../types.ts";
import { serializeTableAlter } from "./alter.ts";
import { serializeTableCreate } from "./create.ts";
import { serializeTableDrop } from "./drop.ts";

export function serializeTableOperation(
  operation: DiffOperation<TableDefinition>,
): string {
  switch (operation.type) {
    case "create":
      return serializeTableCreate(operation.object);
    case "drop":
      return serializeTableDrop(operation.object);
    case "alter":
      return serializeTableAlter(operation);
  }
}

export { serializeTableCreate, serializeTableDrop, serializeTableAlter };
