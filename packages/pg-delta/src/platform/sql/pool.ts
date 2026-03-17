/**
 * Low-level pg Pool factory with custom type handlers.
 * Shared pg pool factory kept in the runtime boundary.
 */

import { Effect, Option, Schedule } from "effect";
import {
  Pool,
  type NodePgPoolClient as PoolClient,
  type NodePgPoolConfig as PoolConfig,
  types,
} from "../../adapters/pg-runtime.ts";
import { ensureError } from "../../utils.ts";
import { ConnectionError, ConnectionTimeoutError } from "./errors.ts";
import type { PgRuntimeConfigApi } from "./runtime-config.ts";
import { getDefaultRuntimeConfig } from "./runtime-config.ts";
import { parseSslConfig } from "./ssl-config.ts";

// ============================================================================
// Array Parser
// ============================================================================

/**
 * Parse PostgreSQL array string into JavaScript array.
 * Handles: {val1,val2}, {NULL,val}, {"quoted,val"}, nested arrays.
 */
function parseArray(
  value: string,
  parseElement: (val: string) => unknown = (v) => v,
) {
  if (!value || value === "{}") return [];

  // Remove outer braces
  const inner = value.slice(1, -1);
  if (inner === "") return [];

  const result: unknown[] = [];
  let current = "";
  let inQuotes = false;
  let depth = 0;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];

    if (char === '"' && inner[i - 1] !== "\\") {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === "{" && !inQuotes) {
      depth++;
      current += char;
    } else if (char === "}" && !inQuotes) {
      depth--;
      current += char;
    } else if (char === "," && !inQuotes && depth === 0) {
      result.push(parseElement(current));
      current = "";
    } else {
      current += char;
    }
  }

  if (current !== "") {
    result.push(parseElement(current));
  }

  return result;
}

/**
 * Parse element, handling NULL, quoted strings, and unquoted values.
 */
function parseStringElement(val: string): string | null {
  if (val === "NULL") return null;
  if (val.startsWith('"') && val.endsWith('"')) {
    // Unescape quoted string
    return val.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return val;
}

function parseIntElement(val: string): number | null {
  if (val === "NULL") return null;
  return Number.parseInt(val, 10);
}

// ============================================================================
// Type Parsers
// ============================================================================

// int2vector: "1 2 3" -> [1, 2, 3]
// @ts-expect-error - pg types expects TypeId but raw OID numbers work fine
types.setTypeParser(22, (val: string) => {
  if (!val || val === "") return [];
  return val
    .split(" ")
    .map(Number)
    .filter((n: number) => !Number.isNaN(n));
});

// bigint: string -> BigInt
types.setTypeParser(20, (val: string) => BigInt(val));

// PostgreSQL array types
// @ts-expect-error - pg types expects TypeId but raw OID numbers work fine
types.setTypeParser(1002, (val: string) => parseArray(val, parseStringElement)); // "char"[]
// @ts-expect-error - pg types expects TypeId but raw OID numbers work fine
types.setTypeParser(1009, (val: string) => parseArray(val, parseStringElement)); // text[]
// @ts-expect-error - pg types expects TypeId but raw OID numbers work fine
types.setTypeParser(1015, (val: string) => parseArray(val, parseStringElement)); // varchar[]
// @ts-expect-error - pg types expects TypeId but raw OID numbers work fine
types.setTypeParser(1005, (val: string) => parseArray(val, parseIntElement)); // int2[]
// @ts-expect-error - pg types expects TypeId but raw OID numbers work fine
types.setTypeParser(1007, (val: string) => parseArray(val, parseIntElement)); // int4[]
// @ts-expect-error - pg types expects TypeId but raw OID numbers work fine
types.setTypeParser(1016, (val: string) => parseArray(val, parseIntElement)); // int8[]

// ============================================================================
// Pool Factory
// ============================================================================

/**
 * Options for creating a Pool with event listeners.
 */
interface CreatePoolOptions extends Partial<PoolConfig> {
  /** Called when a new client connects to the pool */
  onConnect?: (client: PoolClient) => void | Promise<void>;
  /** Called when an idle client emits an error */
  onError?: (err: Error, client: PoolClient) => void;
  /** Called when a client is acquired from the pool */
  onAcquire?: (client: PoolClient) => void;
  /** Called when a client is removed from the pool */
  onRemove?: (client: PoolClient) => void;
}

/**
 * Create a Pool with custom type handlers and optional event listeners.
 */
export function createPool(
  connectionString: string,
  options?: CreatePoolOptions,
  runtimeConfig: PgRuntimeConfigApi = getDefaultRuntimeConfig(),
) {
  const { onConnect, onError, onAcquire, onRemove, ...config } = options ?? {};
  const pool = new Pool({
    connectionString,
    max: runtimeConfig.poolMax,
    connectionTimeoutMillis: runtimeConfig.connectionTimeoutMs,
    ...config,
  });

  if (onConnect) pool.on("connect", onConnect);
  if (onError) pool.on("error", onError);
  if (onAcquire) pool.on("acquire", onAcquire);
  if (onRemove) pool.on("remove", onRemove);

  return pool;
}

/**
 * End a pool and wait for all client sockets to fully close.
 *
 * pg-pool's `pool.end()` resolves once clients are removed from its
 * internal bookkeeping, but the underlying `client.end()` calls (which
 * close the TCP/TLS sockets) are fired asynchronously *after* that.
 * If the server (e.g. a test container) is stopped right after
 * `pool.end()` resolves, the still-open sockets receive an unexpected
 * RST and emit unhandled "Connection terminated unexpectedly" errors.
 *
 * This helper waits for every `remove` event — which pg-pool emits
 * inside each `client.end()` callback — ensuring all sockets are
 * truly closed before it resolves.
 */
export function endPool(pool: Pool) {
  const clientCount = pool.totalCount;

  if (clientCount === 0) {
    return pool.end();
  }

  return new Promise<void>((resolve, reject) => {
    let removed = 0;
    pool.on("remove", function onRemove() {
      if (++removed >= clientCount) {
        pool.removeListener("remove", onRemove);
        resolve();
      }
    });
    pool.end().catch(reject);
  });
}

// ============================================================================
// Validated Pool (SSL + create + connection validation)
// ============================================================================

const CONNECT_RETRY_BASE_DELAY = "200 millis";
const CONNECT_RETRY_TIMES = 2;

interface CreateValidatedPoolOptions {
  label?: "source" | "target";
  onConnect?: (client: PoolClient) => Promise<void>;
  onError?: (err: Error & { code?: string }) => void;
  retries?: number;
}

/**
 * Validate that a pool can successfully connect.
 * Acquires and immediately releases one client, with configurable timeout and retry.
 */
export const validatePoolConnection = (
  pool: Pool,
  label: "source" | "target",
  connectTimeoutMs: number,
  retries = CONNECT_RETRY_TIMES,
) => {
  const connectAndRelease = Effect.gen(function* () {
    const connected = yield* Effect.tryPromise({
      try: async () => {
        const client = await pool.connect();
        client.release();
      },
      catch: (error) =>
        new ConnectionError({
          message: `Failed to connect to ${label} database: ${error instanceof Error ? error.message : String(error)}`,
          label,
          cause: ensureError(error),
        }),
    }).pipe(Effect.timeoutOption(connectTimeoutMs));

    if (Option.isNone(connected)) {
      return yield* Effect.fail(
        new ConnectionTimeoutError({
          message:
            `Connection to ${label} database timed out after ${connectTimeoutMs}ms. ` +
            "The server may require SSL, use an invalid certificate, or be unreachable.",
          label,
          timeoutMs: connectTimeoutMs,
        }),
      );
    }
  });

  return retries > 0
    ? Effect.retry(
        connectAndRelease,
        Schedule.exponential(CONNECT_RETRY_BASE_DELAY).pipe(
          Schedule.compose(Schedule.recurs(retries)),
        ),
      )
    : connectAndRelease;
};

/**
 * Create a validated pool: parse SSL, create pool, validate connection.
 * Returns `{ pool, close }` for manual lifecycle management.
 */
export const createValidatedPool = (
  url: string,
  options: CreateValidatedPoolOptions = {},
  runtimeConfig: PgRuntimeConfigApi = getDefaultRuntimeConfig(),
) =>
  Effect.gen(function* () {
    const label = options.label ?? "target";
    const retries = options.retries ?? 0;

    const sslConfig = yield* parseSslConfig(url, label, runtimeConfig);

    const pool = yield* Effect.try({
      try: () =>
        createPool(
          sslConfig.cleanedUrl,
          {
            ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
            ...(options.onConnect ? { onConnect: options.onConnect } : {}),
            ...(options.onError
              ? { onError: options.onError as CreatePoolOptions["onError"] }
              : {}),
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

    yield* validatePoolConnection(
      pool,
      label,
      runtimeConfig.connectTimeoutMs,
      retries,
    ).pipe(
      Effect.tapError(() =>
        Effect.tryPromise({
          try: () => pool.end().catch(() => {}),
          catch: () =>
            new ConnectionError({
              label,
              message: `Failed to clean up ${label} pool after connection validation.`,
            }),
        }).pipe(Effect.catch(() => Effect.void)),
      ),
    );

    return { pool, close: () => endPool(pool) };
  });
