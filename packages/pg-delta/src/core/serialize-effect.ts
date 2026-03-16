import { Effect } from "effect";
import { ensureError } from "../utils.ts";
import type { Change } from "./change.types.ts";
import {
  IntegrationSerializationError,
  InvariantViolationError,
} from "./errors.ts";
import type { ChangeSerializer } from "./integrations/serialize/serialize.types.ts";

export const serializeChange = (
  change: Change,
  serializer?: ChangeSerializer,
  options?: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    if (serializer) {
      const effect = yield* Effect.try({
        try: () => serializer(change),
        catch: (error) => {
          if (error instanceof InvariantViolationError) return error;
          if (error instanceof IntegrationSerializationError) return error;
          return new IntegrationSerializationError({
            message: `Custom serializer threw for ${change.objectType} ${change.operation} change.`,
            cause: ensureError(error),
          });
        },
      });

      const serialized = yield* effect;
      if (serialized !== undefined) {
        return serialized;
      }
    }

    return yield* change.serialize(options);
  });
