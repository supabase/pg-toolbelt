import { Effect, type Scope } from "effect";
import type { Pool } from "pg";
import { escapeIdentifier } from "pg";
import {
  CatalogExtractionError,
  ConnectionError,
  ConnectionTimeoutError,
  SslConfigError,
} from "../errors.ts";
import { createPool, endPool } from "../postgres-config.ts";
import { parseSslConfig } from "../plan/ssl-config.ts";
import type { DatabaseApi } from "./database.ts";

const DEFAULT_CONNECT_TIMEOUT_MS =
  Number(process.env.PGDELTA_CONNECT_TIMEOUT_MS) || 2_500;

/**
 * Create a DatabaseApi backed by a scoped pg Pool.
 * The pool is automatically closed when the Scope finalizes.
 *
 * This replaces the manual try/finally pool cleanup pattern in
 * create.ts and apply.ts.
 */
export const makeScopedPool = (
  url: string,
  options?: { role?: string; label?: "source" | "target" },
): Effect.Effect<
  DatabaseApi,
  ConnectionError | ConnectionTimeoutError | SslConfigError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const label = options?.label ?? "target";

    // Parse SSL config
    const sslConfig = yield* Effect.tryPromise({
      try: () => parseSslConfig(url, label),
      catch: (err) =>
        new SslConfigError({
          message: `SSL config failed for ${label}: ${err}`,
          cause: err,
        }),
    });

    // Create pool with acquireRelease for automatic cleanup
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createPool(sslConfig.cleanedUrl, {
          ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
          onError: (err: Error & { code?: string }) => {
            if (err.code !== "57P01") {
              console.error("Pool error:", err);
            }
          },
          onConnect: async (client) => {
            await client.query("SET search_path = ''");
            if (options?.role) {
              await client.query(
                `SET ROLE ${escapeIdentifier(options.role)}`,
              );
            }
          },
        }),
      ),
      (pool) => Effect.promise(() => endPool(pool)),
    );

    // Validate connectivity with timeout
    yield* Effect.tryPromise({
      try: async () => {
        const timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS;
        const client = await Promise.race([
          pool.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(`Connection timed out after ${timeoutMs}ms`),
                ),
              timeoutMs,
            ),
          ),
        ]);
        client.release();
      },
      catch: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("timed out")) {
          return new ConnectionTimeoutError({
            message: `Connection to ${label} database timed out after ${DEFAULT_CONNECT_TIMEOUT_MS}ms`,
            label,
            timeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
          });
        }
        return new ConnectionError({
          message: `Failed to connect to ${label} database: ${msg}`,
          label,
          cause: err,
        });
      },
    });

    return wrapPool(pool);
  });

/**
 * Wrap an existing pg Pool as a DatabaseApi (no lifecycle management).
 * Used when the caller owns the pool (e.g. declarative-apply with provided pool).
 */
export const wrapPool = (pool: Pool): DatabaseApi => ({
  query: <R = Record<string, unknown>>(sql: string, values?: unknown[]) =>
    Effect.tryPromise({
      try: async () => {
        const result = await pool.query(sql, values);
        return result as unknown as { rows: R[]; rowCount: number | null };
      },
      catch: (err) =>
        new CatalogExtractionError({
          message: `Query failed: ${err instanceof Error ? err.message : err}`,
          cause: err,
        }),
    }),
  getPool: () => pool,
});
