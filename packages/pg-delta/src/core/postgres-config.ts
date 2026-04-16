/**
 * PostgreSQL connection configuration with custom type handlers.
 */

import type { ClientBase, PoolClient, PoolConfig } from "pg";
import { escapeIdentifier, Pool, types } from "pg";
import { normalizeConnectionUrl } from "./connection-url.ts";
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
const DEFAULT_CONNECT_TIMEOUT_MS =
  Number(process.env.PGDELTA_CONNECT_TIMEOUT_MS) || 2_500;
const DEFAULT_CONNECT_MAX_ATTEMPTS =
  Number(process.env.PGDELTA_CONNECT_MAX_ATTEMPTS) || 3;
const DEFAULT_CONNECT_BASE_BACKOFF_MS =
  Number(process.env.PGDELTA_CONNECT_BASE_BACKOFF_MS) || 250;
const DEFAULT_CONNECT_MAX_BACKOFF_MS =
  Number(process.env.PGDELTA_CONNECT_MAX_BACKOFF_MS) || 1_000;

// PostgreSQL auth-class SQLSTATE codes: not retryable.
const NON_RETRYABLE_PG_CODES = new Set([
  "28000", // invalid_authorization_specification
  "28P01", // invalid_password
  "28P02", // pgdelta: alias reserved here to future-proof against new auth codes
]);

// Non-retryable TLS/SSL markers. The `pg` driver surfaces TLS failures as
// either plain Node `Error` instances with a code on `ERR_TLS_*` or error
// messages that include well-known cert/TLS terminology; we match both
// because node-pg normalises some of these.
const TLS_MESSAGE_MARKERS = [
  "self-signed certificate",
  "self signed certificate",
  "unable to verify the first certificate",
  "certificate has expired",
  "tls",
  "ssl",
];

/**
 * Return true when `err` represents a transient connect failure that makes
 * sense to retry with backoff (e.g. refused connections, DNS blips, our own
 * eager-connect timeout wrapper). Returns false for permanent failures such
 * as authentication errors, TLS negotiation errors, and `ENOTFOUND`.
 *
 * Unknown errors are treated as retryable on purpose: transient-by-default
 * is safer here because a duplicated retry is strictly cheaper than a spurious
 * hard failure during catalog extraction.
 */
export function isRetryableConnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return true;
  const code = (err as NodeJS.ErrnoException & { code?: string }).code;

  if (code && NON_RETRYABLE_PG_CODES.has(code)) return false;
  if (code === "ENOTFOUND") return false;
  if (code && typeof code === "string" && code.startsWith("ERR_TLS")) {
    return false;
  }

  const message = err.message?.toLowerCase() ?? "";
  // Our own eager-connect timeout wrapper is retryable (flaky network).
  if (message.includes("timed out after")) return true;
  for (const marker of TLS_MESSAGE_MARKERS) {
    if (message.includes(marker)) return false;
  }
  return true;
}

/**
 * Retry an async `connect` operation with bounded exponential backoff.
 * Stops immediately on a non-retryable error. On exhausted attempts, throws
 * the last observed error.
 *
 * Exposed for testing — production call sites always go through
 * {@link createManagedPool}.
 */
export async function connectWithRetry<T>(opts: {
  connect: (attempt: number) => Promise<T>;
  isRetryable?: (err: unknown) => boolean;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_CONNECT_MAX_ATTEMPTS;
  const baseBackoffMs = opts.baseBackoffMs ?? DEFAULT_CONNECT_BASE_BACKOFF_MS;
  const maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_CONNECT_MAX_BACKOFF_MS;
  const isRetryable = opts.isRetryable ?? isRetryableConnectError;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await opts.connect(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryable(err)) {
        throw err;
      }
      const backoff = Math.min(
        baseBackoffMs * 2 ** (attempt - 1),
        maxBackoffMs,
      );
      await sleep(backoff);
    }
  }
  // Unreachable: loop either returns or throws.
  throw lastError;
}

/**
 * Options for creating a Pool with event listeners.
 */
interface CreatePoolOptions extends Partial<PoolConfig> {
  /** Called when a new client connects to the pool */
  onConnect?: (client: ClientBase) => void | Promise<void>;
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

  if (onConnect) {
    const pendingClientSetup = new WeakMap<PoolClient, Promise<void>>();
    const waitForClientSetup = async (client: PoolClient) => {
      const setup = pendingClientSetup.get(client);
      if (setup) {
        await setup;
        return;
      }
      throw new Error(
        "Internal error: pool client was acquired before async onConnect setup was registered. This indicates a bug in the pool wrapper logic; please report it with reproduction steps.",
      );
    };
    const originalConnect = pool.connect.bind(pool);

    pool.on("connect", (client) => {
      pendingClientSetup.set(
        client,
        Promise.resolve().then(() => onConnect(client)),
      );
    });

    pool.connect = ((
      callback?: (
        err: Error | undefined,
        client: PoolClient | undefined,
        release: (err?: Error | boolean) => void,
      ) => void,
    ) => {
      if (!callback) {
        return originalConnect().then(async (client) => {
          try {
            await waitForClientSetup(client);
            return client;
          } catch (setupError) {
            (client as PoolClient).release?.(setupError as Error);
            throw setupError;
          }
        });
      }

      return originalConnect(async (err, client, release) => {
        if (err || !client) {
          callback(err, client, release);
          return;
        }

        try {
          await waitForClientSetup(client);
          callback(err, client, release);
        } catch (setupError) {
          release(setupError as Error);
          callback(setupError as Error, undefined, () => {});
        }
      });
    }) as Pool["connect"];
  }
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
  // Normalize percent-encoded IPv6 hosts (e.g. `2406%3A...%3Ab3c9`) into the
  // canonical bracketed form before the URL reaches `parseSslConfig` or pg.
  // Non-IPv6 hosts are returned unchanged.
  const normalizedUrl = normalizeConnectionUrl(url);
  const sslConfig = await parseSslConfig(
    normalizedUrl,
    options?.label ?? "target",
  );
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

  // Eagerly validate connectivity so SSL/auth failures surface immediately
  // instead of hanging on the first real query. node-pg's connectionTimeoutMillis
  // is not reliably enforced under Bun when SSL negotiation hangs. Transient
  // failures (refused connections, flaky DNS, our own timeout wrapper) are
  // retried with bounded exponential backoff; auth/TLS/ENOTFOUND fail fast.
  const label = options?.label ?? "target";
  const timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS;
  try {
    const client = await connectWithRetry({
      connect: () =>
        Promise.race([
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
        ]),
    });
    client.release();
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }

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
