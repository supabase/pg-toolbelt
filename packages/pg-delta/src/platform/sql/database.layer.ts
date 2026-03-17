import * as PgClient from "@effect/sql-pg/PgClient";
import { Effect } from "effect";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import {
  escapeIdentifier,
  type NodePgPool as Pool,
  type NodePgPoolClient as PoolClient,
} from "../../adapters/pg-runtime.ts";
import { CatalogExtractionError } from "../../core/errors.ts";
import { ensureError } from "../../utils.ts";
import {
  type DatabaseApi,
  type DatabaseConnectionApi,
  fromPgClient,
  type QueryInput,
} from "./database.service.ts";
import { ConnectionError } from "./errors.ts";
import { createPool, endPool, validatePoolConnection } from "./pool.ts";
import {
  makePgRuntimeConfigLayer,
  PgRuntimeConfigService,
} from "./runtime-config.ts";
import { parseSslConfig } from "./ssl-config.ts";

const queryError = (error: unknown) =>
  new CatalogExtractionError({
    message: `Query failed: ${error instanceof Error ? error.message : String(error)}`,
    cause: error,
  });

const connectionError = (
  error: unknown,
  label: "source" | "target" = "target",
) =>
  new ConnectionError({
    message: `Failed to acquire ${label} database connection: ${error instanceof Error ? error.message : String(error)}`,
    label,
    cause: ensureError(error),
  });

export const makeScopedSqlDatabaseEffect = (
  url: string,
  options?: { role?: string; label?: "source" | "target" },
) => defaultDatabaseLayer.makeScopedSqlDatabaseEffect(url, options);

export const makeScopedSqlDatabase = (
  url: string,
  options?: { role?: string; label?: "source" | "target" },
) =>
  makeScopedSqlDatabaseEffect(url, options).pipe(
    Effect.provide(makePgRuntimeConfigLayer()),
  );

type OwnedPoolState = {
  readonly compatiblePool: Pool;
  readonly databases: Map<string, DatabaseApi>;
};

interface SqlPgCompatibleClient {
  readonly processID?: number;
  readonly off: (...args: unknown[]) => SqlPgCompatibleClient;
  readonly on: (...args: unknown[]) => SqlPgCompatibleClient;
  readonly once: (...args: unknown[]) => SqlPgCompatibleClient;
  readonly query: (...args: unknown[]) => unknown;
  readonly release: (release?: unknown) => void;
  readonly removeListener: (...args: unknown[]) => SqlPgCompatibleClient;
}

type SqlPgCompatiblePool = Pool & {
  __sqlPgCompatiblePool?: Pool;
  options?: Record<string, unknown>;
};

type DatabaseLayerDependencies = {
  readonly createPool: typeof createPool;
  readonly endPool: typeof endPool;
  readonly parseSslConfig: typeof parseSslConfig;
  readonly pgClientFromPool: typeof PgClient.fromPool;
};

const defaultDatabaseLayerDependencies: DatabaseLayerDependencies = {
  createPool,
  endPool,
  parseSslConfig,
  pgClientFromPool: PgClient.fromPool,
};

export const createDatabaseLayer = (
  overrides: Partial<DatabaseLayerDependencies> = {},
) => {
  const dependencies = {
    ...defaultDatabaseLayerDependencies,
    ...overrides,
  } satisfies DatabaseLayerDependencies;
  const ownedPoolStates = new WeakMap<Pool, OwnedPoolState>();

  const getOwnedPoolState = (pool: Pool): OwnedPoolState => {
    const existing = ownedPoolStates.get(pool);
    if (existing) {
      return existing;
    }

    const state: OwnedPoolState = {
      compatiblePool: createSqlPgCompatiblePool(pool),
      databases: new Map(),
    };
    ownedPoolStates.set(pool, state);
    return state;
  };

  const withOwnedPoolClient = <A, E, R>(
    pool: Pool,
    label: "source" | "target" | undefined,
    use: (client: PgClient.PgClient) => Effect.Effect<A, E, R>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* dependencies
          .pgClientFromPool({
            acquire: Effect.succeed(getOwnedPoolState(pool).compatiblePool),
            applicationName: "@supabase/pg-delta",
          })
          .pipe(
            Effect.provide(Reactivity.layer),
            Effect.mapError((error) => connectionError(error, label)),
          );

        return yield* use(client);
      }),
    );

  const makeScopedSqlDatabaseEffect = (
    url: string,
    options?: { role?: string; label?: "source" | "target" },
  ) =>
    Effect.gen(function* () {
      const label = options?.label ?? "target";
      const runtimeConfig = yield* PgRuntimeConfigService;
      const connectTimeoutMs = runtimeConfig.connectTimeoutMs;

      const sslConfig = yield* dependencies.parseSslConfig(
        url,
        label,
        runtimeConfig,
      );

      const pool = yield* Effect.acquireRelease(
        Effect.sync(() =>
          dependencies.createPool(
            sslConfig.cleanedUrl,
            {
              ...(sslConfig.ssl !== undefined ? { ssl: sslConfig.ssl } : {}),
            },
            runtimeConfig,
          ),
        ),
        (pool) =>
          Effect.tryPromise({
            try: () => dependencies.endPool(pool),
            catch: (e) => e,
          }).pipe(Effect.orDie),
      );

      const compatiblePool = createSqlPgCompatiblePool(pool);

      yield* validatePoolConnection(pool, label, connectTimeoutMs);

      const pgClient = yield* dependencies
        .pgClientFromPool({
          acquire: Effect.succeed(compatiblePool),
          applicationName: "@supabase/pg-delta",
        })
        .pipe(
          Effect.provide(Reactivity.layer),
          Effect.mapError((error) => connectionError(error, label)),
        );

      return fromPgClient(pgClient, {
        queryError,
        connectionError: (error) => connectionError(error, label),
        prepareConnection: prepareConnection(options?.role),
      });
    });

  const fromPool = (
    pool: Pool,
    options?: { readonly label?: "source" | "target" },
  ): DatabaseApi => {
    const state = getOwnedPoolState(pool);
    const labelKey = options?.label ?? "";
    const cached = state.databases.get(labelKey);
    if (cached) {
      return cached;
    }

    const database: DatabaseApi = {
      query: <R = Record<string, unknown>>(
        query: QueryInput,
        values?: readonly unknown[],
      ) =>
        withOwnedPoolClient(pool, options?.label, (client) =>
          fromPgClient(client, {
            queryError,
            connectionError: (error) => connectionError(error, options?.label),
          }).query<R>(query, values),
        ).pipe(Effect.mapError(queryError)),
      withConnection: (use) =>
        withOwnedPoolClient(pool, options?.label, (client) =>
          fromPgClient(client, {
            queryError,
            connectionError: (error) => connectionError(error, options?.label),
          }).withConnection(use),
        ),
    };

    state.databases.set(labelKey, database);
    return database;
  };

  return {
    makeScopedSqlDatabaseEffect,
    fromPool,
  };
};

function createSqlPgCompatiblePool(pool: Pool): Pool {
  const candidate = pool as SqlPgCompatiblePool;

  if (candidate.__sqlPgCompatiblePool) {
    return candidate.__sqlPgCompatiblePool;
  }

  const compatiblePool = new Proxy(candidate, {
    get(target, property, receiver) {
      if (property === "options") {
        return target.options ?? {};
      }

      if (property === "connect") {
        return (
          callback?: (
            err: Error | undefined,
            client: SqlPgCompatibleClient,
            release: (release?: unknown) => void,
          ) => void,
        ) => {
          if (callback) {
            pool.connect(((
              error: unknown,
              client: PoolClient | undefined,
              release?: (destroy?: unknown) => void,
            ) =>
              callback(
                error ? toSqlPgError(error) : undefined,
                client
                  ? toSqlPgCompatibleClient(client)
                  : failedSqlPgClient(
                      toSqlPgError(
                        error ?? new Error("No client returned by pg pool"),
                      ),
                    ),
                (destroy) => release?.(destroy as never),
              )) as never);
            return;
          }

          return pool.connect().then(toSqlPgCompatibleClient);
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(pool) : value;
    },
  }) as Pool;

  candidate.__sqlPgCompatiblePool = compatiblePool;
  return compatiblePool;
}

const prepareConnection =
  (role: string | undefined) => (connection: DatabaseConnectionApi) =>
    Effect.gen(function* () {
      yield* connection.query("SET search_path = ''");
      if (role) {
        yield* connection.query(`SET ROLE ${escapeIdentifier(role)}`);
      }
    });

function toSqlPgCompatibleClient(client: PoolClient): SqlPgCompatibleClient {
  const candidate = client as PoolClient & {
    __sqlPgCompatibleClient?: SqlPgCompatibleClient;
    processID?: number;
  };

  if (candidate.__sqlPgCompatibleClient) {
    return candidate.__sqlPgCompatibleClient;
  }

  const compatibleClient: SqlPgCompatibleClient = {
    off: (...args) => {
      client.off(...(args as Parameters<typeof client.off>));
      return compatibleClient;
    },
    on: (...args) => {
      client.on(...(args as Parameters<typeof client.on>));
      return compatibleClient;
    },
    once: (...args) => {
      client.once(...(args as Parameters<typeof client.once>));
      return compatibleClient;
    },
    processID: candidate.processID,
    query: (...args) =>
      client.query(...(args as Parameters<typeof client.query>)),
    release: (release) => client.release(release as never),
    removeListener: (...args) => {
      client.removeListener(
        ...(args as Parameters<typeof client.removeListener>),
      );
      return compatibleClient;
    },
  };

  candidate.__sqlPgCompatibleClient = compatibleClient;
  return compatibleClient;
}

function failedSqlPgClient(error: Error): SqlPgCompatibleClient {
  const compatibleClient: SqlPgCompatibleClient = {
    off: () => compatibleClient,
    on: () => compatibleClient,
    once: () => compatibleClient,
    processID: undefined,
    query: (...args) => {
      const callback = args.find(
        (
          arg,
        ): arg is (error: Error, result: { rows: []; rowCount: 0 }) => void =>
          typeof arg === "function",
      );
      callback?.(error, {
        rowCount: 0,
        rows: [],
      });
      return undefined;
    },
    release: () => {},
    removeListener: () => compatibleClient,
  };

  return compatibleClient;
}

function toSqlPgError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const defaultDatabaseLayer = createDatabaseLayer();

export const fromPool = (
  pool: Pool,
  options?: { readonly label?: "source" | "target" },
) => defaultDatabaseLayer.fromPool(pool, options);
