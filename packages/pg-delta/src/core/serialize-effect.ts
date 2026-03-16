import { Effect } from "effect";
import type { Change } from "./change.types.ts";
import {
  IntegrationSerializationError,
  InvariantViolationError,
} from "./errors.ts";
import type { ChangeSerializer } from "./integrations/serialize/serialize.types.ts";

const normalizeInvariantFailure = (
  error: unknown,
  message: string,
): InvariantViolationError =>
  error instanceof InvariantViolationError
    ? error
    : new InvariantViolationError({
        area: "serialization",
        message,
        cause: error,
      });

const normalizeIntegrationFailure = (
  error: unknown,
  message: string,
): InvariantViolationError | IntegrationSerializationError => {
  if (
    error instanceof InvariantViolationError ||
    error instanceof IntegrationSerializationError
  ) {
    return error;
  }

  return new IntegrationSerializationError({
    message,
    cause: error,
  });
};

export const serializeChange = (
  change: Change,
  serializer?: ChangeSerializer,
  options?: Record<string, unknown>,
): Effect.Effect<
  string,
  InvariantViolationError | IntegrationSerializationError
> =>
  Effect.gen(function* () {
    if (serializer) {
      const effect = yield* Effect.try({
        try: () => serializer(change),
        catch: (error) =>
          new IntegrationSerializationError({
            message: `Custom serializer threw for ${change.objectType} ${change.operation} change.`,
            cause: error,
          }),
      }).pipe(
        Effect.mapError((error) =>
          normalizeIntegrationFailure(
            error,
            `Custom serializer failed for ${change.objectType} ${change.operation} change.`,
          ),
        ),
      );

      const serialized = yield* effect;
      if (serialized !== undefined) {
        return serialized;
      }
    }

    return yield* change
      .serialize(options)
      .pipe(
        Effect.mapError((error) =>
          normalizeInvariantFailure(
            error,
            `Failed to serialize ${change.objectType} ${change.operation} change.`,
          ),
        ),
      );
  });
