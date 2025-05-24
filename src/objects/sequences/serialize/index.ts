import type { DiffOperation } from "../../../diff/types.ts";
import type { SequenceDefinition } from "../types.ts";
import { serializeSequenceAlter } from "./alter.ts";
import { serializeSequenceCreate } from "./create.ts";
import { serializeSequenceDrop } from "./drop.ts";

export function serializeSequenceOperation(
  operation: DiffOperation<SequenceDefinition>,
): string {
  switch (operation.type) {
    case "create":
      return serializeSequenceCreate(operation.object);
    case "drop":
      return serializeSequenceDrop(operation.object);
    case "alter":
      return serializeSequenceAlter(operation);
  }
}

export {
  serializeSequenceCreate,
  serializeSequenceDrop,
  serializeSequenceAlter,
};
