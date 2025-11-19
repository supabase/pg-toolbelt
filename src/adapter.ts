import type { PGlite } from "@electric-sql/pglite";
import { type Sql } from "postgres";

/**
 * Normalize PGlite row data to match postgres package expectations
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  const numericArrayKeys = new Set(["key_columns", "foreign_key_columns"]);

  for (const [key, value] of Object.entries(row)) {
    if (
      typeof value === "string" &&
      value.startsWith("{") &&
      value.endsWith("}")
    ) {
      // Existing: parse Postgres array string -> JS array
      const inner = value.slice(1, -1);
      if (inner === "") {
        normalized[key] = [];
      } else {
        const items = inner.split(",").map((item) => {
          const trimmed = item.trim().replace(/^"(.*)"$/, "$1"); // strip quotes if present
          const num = Number(trimmed);
          return Number.isNaN(num) ? trimmed : num;
        });
        normalized[key] = items;
      }
    } else if (
      typeof value === "string" &&
      (key === "key_columns" ||
        key === "foreign_key_columns" ||
        key === "statistics_target" ||
        key === "column_options")
    ) {
      // Existing: try JSON, then fallback
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && numericArrayKeys.has(key)) {
          normalized[key] = parsed.map((v: unknown) =>
            typeof v === "string" ? Number(v) : v
          );
        } else {
          normalized[key] = Array.isArray(parsed) ? parsed : [parsed];
        }
      } catch {
        const num = Number(value);
        normalized[key] = [Number.isNaN(num) ? value : num];
      }
    } else if (Array.isArray(value)) {
      // NEW: Coerce numeric-looking arrays for keys that should be numeric
      if (numericArrayKeys.has(key)) {
        normalized[key] = value.map((item) => {
          if (typeof item === "string") {
            const num = Number(item);
            return Number.isNaN(num) ? item : num;
          }
          return item;
        });
      } else {
        // Existing: recursively normalize nested objects
        normalized[key] = value.map((item) => {
          if (typeof item === "object" && item !== null) {
            return normalizeRow(item as Record<string, unknown>);
          }
          return item;
        });
      }
    } else if (
      typeof value === "number" &&
      (key === "minimum_value" || key === "maximum_value")
    ) {
      normalized[key] = BigInt(value);
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
}

type QueryExecutor = Pick<PGlite, "query">;

interface SqlAdapterOptions {
  onEnd?: () => Promise<void>;
  runTransaction?: <T>(callback: (sql: Sql) => Promise<T>) => Promise<T>;
}

function buildQuery(
  strings: TemplateStringsArray,
  values: readonly unknown[]
): { text: string; params: unknown[] } {
  let text = strings[0];
  const params: unknown[] = [];

  for (let i = 0; i < values.length; i++) {
    text += `$${i + 1}${strings[i + 1]}`;
    params.push(values[i]);
  }

  return { text, params };
}

const END_SYMBOL = Symbol.for("pg-diff.pglite.END");
const CLOSE_SYMBOL = Symbol.for("pg-diff.pglite.CLOSE");

class PglitePostgresError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "PostgresError";
  }
}

function createSqlInstance(
  executor: QueryExecutor,
  options: SqlAdapterOptions = {}
): Sql {
  const execute = async <T = any[]>(
    query: string,
    params: readonly unknown[] = []
  ): Promise<T> => {
    const args = Array.isArray(params) ? [...params] : Array.from(params);
    const result = await executor.query(query, args);
    const normalizedRows = result.rows.map((row) =>
      normalizeRow(row as Record<string, unknown>)
    );
    return normalizedRows as T;
  };

  const tagged = async <T = any[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T> => {
    const { text, params } = buildQuery(strings, values);
    return execute<T>(text, params);
  };

  let ended = false;
  const end = async (): Promise<void> => {
    if (ended) {
      return;
    }
    ended = true;
    if (options.onEnd) {
      await options.onEnd();
    }
  };

  const requireTransactionRunner = () => {
    if (!options.runTransaction) {
      throw new Error("Transactions are not supported by this adapter.");
    }
    return options.runTransaction;
  };

  const begin = async (
    callbackOrOptions?:
      | ((sql: Sql) => Promise<unknown>)
      | Record<string, unknown>,
    maybeCallback?: (sql: Sql) => Promise<unknown>
  ): Promise<unknown> => {
    const runner = requireTransactionRunner();
    const callback =
      typeof callbackOrOptions === "function"
        ? callbackOrOptions
        : maybeCallback;

    if (!callback) {
      throw new Error(
        "A transaction callback is required when using the PGlite adapter."
      );
    }

    return runner(callback);
  };

  const unsupportedAsync =
    (method: string) =>
    async (..._args: unknown[]): Promise<never> => {
      throw new Error(
        `Method '${method}' is not supported by the PGlite adapter.`
      );
    };

  const unsupportedSync = (method: string) => (): never => {
    throw new Error(
      `Method '${method}' is not supported by the PGlite adapter.`
    );
  };

  return Object.assign(tagged, {
    __isAdapter: true,
    isSql: true as const,
    END: END_SYMBOL,
    CLOSE: CLOSE_SYMBOL,
    PostgresError: PglitePostgresError,
    options: Object.freeze({ adapter: "pglite" }),
    types: Object.freeze({
      get: unsupportedSync("types.get"),
      set: unsupportedSync("types.set"),
      array: unsupportedSync("types.array"),
      to: unsupportedSync("types.to"),
    }),
    unsafe: async <T = any[]>(
      query: string,
      params?: readonly unknown[],
      _options?: unknown
    ): Promise<T> => execute<T>(query, params ?? []),
    array: <T>(values: readonly T[] = [], _type?: unknown): T[] =>
      Array.from(values),
    json: (value: unknown): unknown => (value === undefined ? null : value),
    begin,
    transaction: begin,
    savepoint: unsupportedAsync("savepoint"),
    release: unsupportedAsync("release"),
    rollback: unsupportedAsync("rollback"),
    end,
    close: end,
    file: unsupportedAsync("file"),
    listen: unsupportedAsync("listen"),
    notify: unsupportedAsync("notify"),
    subscribe: unsupportedAsync("subscribe"),
    copyFrom: unsupportedAsync("copyFrom"),
    copyTo: unsupportedAsync("copyTo"),
    // parameters: null,
    // typed: false,
    // largeObject: null,
    // reserve: unsupportedAsync("reserve"),
  }) as unknown as Sql;
}

/**
 * Create a DbAdapter from a PGlite instance
 */
export function createPgliteAdapter(pg: PGlite): Sql {
  return createSqlInstance(pg, {
    onEnd: async () => {
      await pg.close();
    },
    runTransaction: async <T>(callback: (sql: Sql) => Promise<T>): Promise<T> =>
      pg.transaction(async (tx) => {
        const txOptions: SqlAdapterOptions = {};
        const txSql = createSqlInstance(tx, txOptions);
        txOptions.runTransaction = async <R>(
          nestedCallback: (sql: Sql) => Promise<R>
        ): Promise<R> => nestedCallback(txSql);
        return callback(txSql);
      }),
  });
}

/**
 * Connection input type - can be either a connection URL string or a PGlite instance
 */
export type DbConnection = string | PGlite;

/**
 * Check if a connection is a PGlite instance
 */
export function isPgliteConnection(
  connection: DbConnection
): connection is PGlite {
  return typeof connection !== "string" && "query" in connection;
}
