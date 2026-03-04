/**
 * PostgreSQL connection configuration with custom type handlers.
 */

import type { PoolClient, PoolConfig } from "pg";
import { escapeIdentifier, Pool, types } from "pg";
import { parseSslConfig } from "./plan/ssl-config.ts";

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
): unknown[] {
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

const DEFAULT_POOL_MAX = Number(process.env.PGDELTA_POOL_MAX) || 5;
const DEFAULT_CONNECTION_TIMEOUT_MS =
  Number(process.env.PGDELTA_CONNECTION_TIMEOUT_MS) || 3_000;

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
): Pool {
  const { onConnect, onError, onAcquire, onRemove, ...config } = options ?? {};
  const pool = new Pool({
    connectionString,
    max: DEFAULT_POOL_MAX,
    connectionTimeoutMillis: DEFAULT_CONNECTION_TIMEOUT_MS,
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
/**
 * Create a pool from a connection URL with standard session setup:
 * SSL parsing, search_path isolation, optional SET ROLE, and 57P01 suppression.
 *
 * Returns the pool and a `close` function that properly waits for all sockets
 * to close (via {@link endPool}).
 */
export async function createManagedPool(
  url: string,
  options?: { role?: string; label?: "source" | "target" },
): Promise<{ pool: Pool; close: () => Promise<void> }> {
  const sslConfig = await parseSslConfig(url, options?.label ?? "target");
  const pool = createPool(sslConfig.cleanedUrl, {
    ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
    onError: (err: Error & { code?: string }) => {
      if (err.code !== "57P01") {
        console.error("Pool error:", err);
      }
    },
    onConnect: async (client) => {
      await client.query("SET search_path = ''");
      if (options?.role) {
        await client.query(`SET ROLE ${escapeIdentifier(options.role)}`);
      }
    },
  });
  return { pool, close: () => endPool(pool) };
}

export function endPool(pool: Pool): Promise<void> {
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
