import { Effect } from "effect";
import { InvariantViolationError } from "../errors.ts";

const failObjectInvariant = (
  message: string,
  area: InvariantViolationError["area"] = "serialization",
): Effect.Effect<never, InvariantViolationError> =>
  Effect.fail(
    new InvariantViolationError({
      area,
      message,
    }),
  );

export const ensureUniformGrantablePrivileges = (
  privileges: ReadonlyArray<{ grantable: boolean }>,
  message: string,
): Effect.Effect<void, InvariantViolationError> => {
  const hasGrantable = privileges.some((privilege) => privilege.grantable);
  const hasBase = privileges.some((privilege) => !privilege.grantable);

  if (hasGrantable && hasBase) {
    return failObjectInvariant(message);
  }

  return Effect.void;
};

export const ensureSingleRevokeKind = (
  hasGrantOption: boolean,
  hasBase: boolean,
  message: string,
): Effect.Effect<void, InvariantViolationError> =>
  hasGrantOption && hasBase ? failObjectInvariant(message) : Effect.void;

export const ensureIndexIsSerializable = (
  hasIndexExpressions: boolean,
  hasIndexableColumns: boolean,
): Effect.Effect<void, InvariantViolationError> =>
  hasIndexExpressions || hasIndexableColumns
    ? Effect.void
    : failObjectInvariant(
        "Index requires an indexableObject with columns when key_columns are used",
        "index",
      );
