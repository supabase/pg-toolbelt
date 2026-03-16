import { Effect } from "effect";
import { InvariantViolationError } from "../errors.ts";

export const ensureUniformGrantablePrivileges = (
  privileges: ReadonlyArray<{ grantable: boolean }>,
  message: string,
): Effect.Effect<void, InvariantViolationError> => {
  const hasGrantable = privileges.some((privilege) => privilege.grantable);
  const hasBase = privileges.some((privilege) => !privilege.grantable);

  if (hasGrantable && hasBase) {
    return Effect.fail(
      new InvariantViolationError({
        area: "serialization",
        message,
      }),
    );
  }

  return Effect.void;
};

export const ensureSingleRevokeKind = (
  hasGrantOption: boolean,
  hasBase: boolean,
  message: string,
): Effect.Effect<void, InvariantViolationError> =>
  hasGrantOption && hasBase
    ? Effect.fail(
        new InvariantViolationError({ area: "serialization", message }),
      )
    : Effect.void;

export const ensureIndexIsSerializable = (
  hasIndexExpressions: boolean,
  hasIndexableColumns: boolean,
): Effect.Effect<void, InvariantViolationError> =>
  hasIndexExpressions || hasIndexableColumns
    ? Effect.void
    : Effect.fail(
        new InvariantViolationError({
          area: "index",
          message:
            "Index requires an indexableObject with columns when key_columns are used",
        }),
      );
