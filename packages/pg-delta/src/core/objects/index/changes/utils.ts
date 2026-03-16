import type { Effect } from "effect";
import type { InvariantViolationError } from "../../../errors.ts";
import type { TableLikeObject } from "../../base.model.ts";
import { ensureIndexIsSerializable } from "../../invariants.ts";
import type { Index } from "../index.model.ts";

export function checkIsSerializable(
  index: Index,
  indexableObject?: TableLikeObject,
): Effect.Effect<void, InvariantViolationError> {
  return ensureIndexIsSerializable(
    index.index_expressions !== null,
    indexableObject !== undefined && indexableObject.columns.length > 0,
  );
}
