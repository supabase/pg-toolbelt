import { Effect, type Scope, ServiceMap } from "effect";
import {
  ConnectionError,
  type ConnectionTimeoutError,
  type SslConfigError,
} from "../../platform/sql/errors.ts";
import type { DatabaseApi } from "./database.ts";

interface DatabaseResolverApi {
  readonly fromConnectionString: (
    connectionString: string,
    options?: { readonly role?: string; readonly label?: "source" | "target" },
  ) => Effect.Effect<
    DatabaseApi,
    ConnectionError | ConnectionTimeoutError | SslConfigError,
    Scope.Scope
  >;
}

export const DatabaseResolver = ServiceMap.Reference<DatabaseResolverApi>(
  "@pg-delta/core/DatabaseResolver",
  {
    defaultValue: () => ({
      fromConnectionString: (_connectionString, options) =>
        Effect.fail(
          new ConnectionError({
            message:
              "No database resolver layer was provided. Use @supabase/pg-delta/node, @supabase/pg-delta/bun, or @supabase/pg-delta/adapters/node-pg.",
            label: options?.label ?? "target",
          }),
        ),
    }),
  },
);
