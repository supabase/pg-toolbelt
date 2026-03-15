import { ConfigProvider, Effect, Layer } from "effect";
import type { Pool } from "pg";
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

const logger = getPgDeltaLogger("postgres");

export const nodePgDatabaseResolverLayer = Layer.succeed(DatabaseResolver, {
  fromConnectionString: (connectionString, options) =>
    makeScopedSqlDatabase(connectionString, options),
});

export const fromNodePgPool = (pool: Pool): DatabaseApi => fromPool(pool);

const getDefaultRuntimeConfig = (): PgRuntimeConfigApi =>
  Effect.runSync(loadPgRuntimeConfig(ConfigProvider.fromEnv()));

export async function createManagedPool(
  url: string,
  options?: { role?: string; label?: "source" | "target" },
  runtimeConfig: PgRuntimeConfigApi = getDefaultRuntimeConfig(),
): Promise<{ pool: Pool; close: () => Promise<void> }> {
  const sslConfig = await parseSslConfig(
    url,
    options?.label ?? "target",
    runtimeConfig,
  );
  const pool = createPool(
    sslConfig.cleanedUrl,
    {
      ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
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
  );

  const label = options?.label ?? "target";
  const timeoutMs = runtimeConfig.connectTimeoutMs;
  try {
    const client = await Promise.race([
      pool.connect(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Connection to ${label} database timed out after ${timeoutMs}ms. ` +
                  `The server may require SSL, use an invalid certificate, or be unreachable.`,
              ),
            ),
          timeoutMs,
        ),
      ),
    ]);
    client.release();
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }

  return { pool, close: () => endPool(pool) };
}

export {
  fromPool,
  makeScopedSqlDatabase as makeScopedDatabase,
  makeScopedSqlDatabaseEffect as makeScopedDatabaseEffect,
};

export type { Pool };
