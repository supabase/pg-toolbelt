import type { Effect } from "effect";
import type { Change } from "../../change.types.ts";
import type {
  IntegrationSerializationError,
  InvariantViolationError,
} from "../../errors.ts";

export type ChangeSerializer = (
  change: Change,
) => Effect.Effect<
  string,
  InvariantViolationError | IntegrationSerializationError
>;
