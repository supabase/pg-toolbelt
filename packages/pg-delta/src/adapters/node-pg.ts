import { ConfigProvider, Effect, Layer } from "effect";
import {
  ConnectionError,
  ConnectionTimeoutError,
  type SslConfigError,
} from "../core/errors.ts";
import { getPgDeltaLogger } from "../core/logging.ts";
import type { DatabaseApi } from "../core/services/database.ts";
import { DatabaseResolver } from "../core/services/database-resolver.ts";
import { quoteIdentifier } from "../core/sql-identifier.ts";
import {
  fromPool,
  makeScopedSqlDatabase,
  makeScopedSqlDatabaseEffect,
} from "../platform/sql/database.layer.ts";
import { createPool, endPool } from "../platform/sql/pool.ts";
import {
  loadPgRuntimeConfig,
  type PgRuntimeConfigApi,
} from "../platform/sql/runtime-config.ts";
import { parseSslConfig } from "../platform/sql/ssl-config.ts";
import { ensureError } from "../utils.ts";
import { nodeFileSystemPathLayer } from "./node-platform.ts";
import type { NodePgPool as Pool } from "./pg-runtime.ts";

const logger = getPgDeltaLogger("postgres");

export const nodePgDatabaseResolverLayer = Layer.succeed(DatabaseResolver, {
  fromConnectionString: (connectionString, options) =>
    makeScopedSqlDatabase(connectionString, options).pipe(
      Effect.provide(nodeFileSystemPathLayer),
    ),
});

export const fromNodePgPool = (pool: Pool): DatabaseApi => fromPool(pool);

const getDefaultRuntimeConfig = (): PgRuntimeConfigApi =>
  Effect.runSync(loadPgRuntimeConfig(ConfigProvider.fromEnv()));

export async function createManagedPool(
  url: string,
  options?: { role?: string; label?: "source" | "target" },
  runtimeConfig: PgRuntimeConfigApi = getDefaultRuntimeConfig(),
): Promise<{ pool: Pool; close: () => Promise<void> }> {
  return await Effect.runPromise(
    createManagedPoolEffect(url, options, runtimeConfig),
  );
}

const createManagedPoolEffect = (
  url: string,
  options?: { role?: string; label?: "source" | "target" },
  runtimeConfig: PgRuntimeConfigApi = getDefaultRuntimeConfig(),
): Effect.Effect<
  { pool: Pool; close: () => Promise<void> },
  ConnectionError | ConnectionTimeoutError | SslConfigError
> =>
  Effect.gen(function* () {
    const sslConfig = yield* parseSslConfig(
      url,
      options?.label ?? "target",
      runtimeConfig,
    ).pipe(Effect.provide(nodeFileSystemPathLayer));
    const label = options?.label ?? "target";
    const timeoutMs = runtimeConfig.connectTimeoutMs;
    const pool = yield* Effect.try({
      try: () =>
        createPool(
          sslConfig.cleanedUrl,
          {
            ...{ ssl: sslConfig.ssl },
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
        ),
      catch: (error) =>
        new ConnectionError({
          label,
          message: `Failed to create ${label} pool.`,
          cause: ensureError(error),
        }),
    });
    const releaseOrClose = (client?: { release: () => void }) =>
      Effect.tryPromise({
        try: async () => {
          if (client) {
            client.release();
            return;
          }
          await pool.end().catch(() => {});
        },
        catch: () =>
          new ConnectionError({
            label,
            message: `Failed to clean up ${label} pool after connection validation.`,
          }),
      }).pipe(Effect.catch(() => Effect.void));

    const client = yield* Effect.tryPromise({
      try: () =>
        Promise.race([
          pool.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new ConnectionTimeoutError({
                    message:
                      `Connection to ${label} database timed out after ${timeoutMs}ms. ` +
                      "The server may require SSL, use an invalid certificate, or be unreachable.",
                    label,
                    timeoutMs,
                  }),
                ),
              timeoutMs,
            ),
          ),
        ]),
      catch: (error) =>
        error instanceof ConnectionTimeoutError
          ? error
          : new ConnectionError({
              label,
              message:
                error instanceof Error
                  ? error.message
                  : `Connection to ${label} database failed.`,
              cause: ensureError(error),
            }),
    }).pipe(Effect.tapError(() => releaseOrClose()));

    yield* releaseOrClose(client);
    return { pool, close: () => endPool(pool) };
  });

export {
  fromPool,
  makeScopedSqlDatabase as makeScopedDatabase,
  makeScopedSqlDatabaseEffect as makeScopedDatabaseEffect,
};

export type { Pool };
