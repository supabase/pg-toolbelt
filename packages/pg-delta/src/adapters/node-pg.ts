import { Effect, Layer } from "effect";
import { getPgDeltaLogger } from "../core/logging.ts";
import { DatabaseResolver } from "../core/services/database-resolver.ts";
import { quoteIdentifier } from "../core/sql-identifier.ts";
import {
  fromPool,
  makeScopedSqlDatabase,
  makeScopedSqlDatabaseEffect,
} from "../platform/sql/database.layer.ts";
import { createValidatedPool } from "../platform/sql/pool.ts";
import {
  getDefaultRuntimeConfig,
  type PgRuntimeConfigApi,
} from "../platform/sql/runtime-config.ts";
import { nodeFileSystemPathLayer } from "./node-platform.ts";
import type { NodePgPool as Pool } from "./pg-runtime.ts";

const logger = getPgDeltaLogger("postgres");

export const nodePgDatabaseResolverLayer = Layer.succeed(DatabaseResolver, {
  fromConnectionString: (connectionString, options) =>
    makeScopedSqlDatabase(connectionString, options).pipe(
      Effect.provide(nodeFileSystemPathLayer),
    ),
});

export const fromNodePgPool = (pool: Pool) => fromPool(pool);

export async function createManagedPool(
  url: string,
  options?: { role?: string; label?: "source" | "target" },
  runtimeConfig: PgRuntimeConfigApi = getDefaultRuntimeConfig(),
) {
  return await Effect.runPromise(
    createValidatedPool(
      url,
      {
        label: options?.label,
        retries: 0,
        onError: (err: Error & { code?: string }) => {
          if (err.code !== "57P01") {
            logger.error("Pool error for {label} connection", {
              label: options?.label ?? "target",
              error: err,
            });
          }
        },
        onConnect: async (client) => {
          await client.query("SET search_path = ''");
          if (options?.role) {
            await client.query(`SET ROLE ${quoteIdentifier(options.role)}`);
          }
        },
      },
      runtimeConfig,
    ).pipe(Effect.provide(nodeFileSystemPathLayer)),
  );
}

export {
  fromPool,
  makeScopedSqlDatabase as makeScopedDatabase,
  makeScopedSqlDatabaseEffect as makeScopedDatabaseEffect,
};

export type { Pool };
