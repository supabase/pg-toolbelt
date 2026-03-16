import { describe, expect, mock, test } from "bun:test";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import { Effect, Layer, type Scope } from "effect";
import type { Pool, PoolClient, QueryResult } from "pg";
import { createDatabaseLayer } from "../../platform/sql/database.layer.ts";
import { ConnectionTimeoutError, SslConfigError } from "../errors.ts";
import { PgRuntimeConfigService } from "../runtime-config.ts";

type MockSslConfig =
  | {
      cleanedUrl: string;
      ssl: false;
    }
  | {
      cleanedUrl: string;
      ssl: {
        rejectUnauthorized: boolean;
        ca?: string;
      };
    };

type SqlPgClientDouble = {
  readonly reserve: Effect.Effect<
    {
      executeRaw: (
        sql: string,
        values?: readonly unknown[],
      ) => Effect.Effect<QueryResult<Record<string, unknown>>, never>;
    },
    never
  >;
};

describe("makeScopedPool", () => {
  const DefaultRuntimeConfig = Layer.succeed(PgRuntimeConfigService, {
    poolMax: 5,
    connectionTimeoutMs: 3_000,
    connectTimeoutMs: 100,
    getEnv: () => undefined,
  });

  const TestRuntimeConfig = Layer.succeed(PgRuntimeConfigService, {
    poolMax: 5,
    connectionTimeoutMs: 3_000,
    connectTimeoutMs: 1,
    getEnv: () => undefined,
  });

  test("retries transient connection failures before succeeding", async () => {
    const harness = createHarness(DefaultRuntimeConfig);
    let attempts = 0;
    harness.createPoolMock.mockImplementation(() =>
      makePool({
        connect: () => {
          attempts += 1;
          if (attempts < 3) {
            return Promise.reject(new Error("connection reset"));
          }
          return Promise.resolve(makeClient());
        },
      }),
    );

    await Effect.scoped(harness.makeScopedPool("postgresql://example/db")).pipe(
      Effect.runPromise,
    );

    expect(attempts).toBe(3);
    expect(harness.createPoolMock).toHaveBeenCalledTimes(1);
    expect(harness.fromPoolPgClientMock).toHaveBeenCalledTimes(1);
  });

  test("does not retry SSL configuration failures", async () => {
    const harness = createHarness(DefaultRuntimeConfig);
    harness.parseSslConfigMock.mockImplementationOnce(() =>
      Effect.fail(
        new SslConfigError({
          message: "bad sslmode",
        }),
      ),
    );

    const result = await Effect.scoped(
      harness.makeScopedPool("postgresql://example/db", { label: "source" }),
    ).pipe(Effect.result, Effect.runPromise);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(SslConfigError);
    }
    expect(harness.createPoolMock).not.toHaveBeenCalled();
    expect(harness.fromPoolPgClientMock).not.toHaveBeenCalled();
  });

  test("passes injected runtime config through to SSL parsing", async () => {
    const harness = createHarness(DefaultRuntimeConfig);
    harness.parseSslConfigMock.mockImplementationOnce((...args: unknown[]) =>
      Effect.succeed(
        (() => {
          const [url, _label, runtimeConfig] = args as [
            string,
            "source" | "target",
            { getEnv: (name: string) => string | undefined },
          ];

          return {
            cleanedUrl: url,
            ssl: {
              rejectUnauthorized: true,
              ca: runtimeConfig.getEnv("PGDELTA_SOURCE_SSLROOTCERT"),
            },
          };
        })(),
      ),
    );

    const runtimeConfig = Layer.succeed(PgRuntimeConfigService, {
      poolMax: 5,
      connectionTimeoutMs: 3_000,
      connectTimeoutMs: 100,
      getEnv: (name: string) =>
        name === "PGDELTA_SOURCE_SSLROOTCERT" ? "ca-cert-content" : undefined,
    });

    await Effect.scoped(
      harness.makeScopedPoolEffect("postgresql://example/db", {
        label: "source",
      }),
    ).pipe(
      Effect.provide(runtimeConfig),
      Effect.provide(NodeFileSystem.layer),
      Effect.runPromise,
    );

    expect(harness.createPoolMock).toHaveBeenCalledWith(
      "postgresql://example/db",
      {
        ssl: {
          ca: "ca-cert-content",
          rejectUnauthorized: true,
        },
      },
      expect.objectContaining({
        connectTimeoutMs: 100,
        poolMax: 5,
      }),
    );
  });

  test("retries timeouts and eventually fails with ConnectionTimeoutError", async () => {
    const harness = createHarness(DefaultRuntimeConfig);
    let attempts = 0;
    harness.createPoolMock.mockImplementation(() =>
      makePool({
        connect: () => {
          attempts += 1;
          return new Promise<PoolClient>(() => {});
        },
      }),
    );

    const result = await Effect.scoped(
      harness.makeScopedPoolEffect("postgresql://example/db", {
        label: "target",
      }),
    ).pipe(
      Effect.provide(TestRuntimeConfig),
      Effect.provide(NodeFileSystem.layer),
      Effect.result,
      Effect.runPromise,
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toBeInstanceOf(ConnectionTimeoutError);
    }
    expect(attempts).toBe(3);
    expect(harness.fromPoolPgClientMock).not.toHaveBeenCalled();
  });

  test("wrapPool exposes a sql-pg-compatible callback pool surface", async () => {
    const harness = createHarness(DefaultRuntimeConfig);
    const rawClient = makeClient();
    const rawPool = makePool({
      connect: () => Promise.resolve(rawClient),
    }) as Pool & {
      options?: Record<string, unknown>;
    };

    const result = await harness
      .wrapPool(rawPool)
      .query<{ ok: number }>("select 1")
      .pipe(Effect.runPromise);

    expect(result.rows).toEqual([{ ok: 1 }]);
    expect(result.rowCount).toBe(1);
    expect(harness.fromPoolPgClientMock).toHaveBeenCalledTimes(1);
    expect(harness.acquiredPools).toHaveLength(1);
    expect(
      (harness.acquiredPools[0] as Pool & { options?: Record<string, unknown> })
        .options,
    ).toEqual(expect.any(Object));

    const acquiredPool = harness.acquiredPools[0];
    expect(acquiredPool).toBeDefined();
    if (!acquiredPool) {
      throw new Error("expected acquired pool");
    }

    await new Promise<void>((resolve) => {
      acquiredPool.connect((error, client, release) => {
        expect(error).toBeUndefined();
        expect(client).toBeDefined();
        expect(typeof client?.on).toBe("function");
        expect(typeof client?.once).toBe("function");
        expect(typeof client?.query).toBe("function");
        release();
        resolve();
      });
    });
  });

  test("wrapPool preserves a callback client object on connection failure", async () => {
    const harness = createHarness(DefaultRuntimeConfig);
    const rawPool = makePool({
      connect: () => Promise.reject(new Error("connection reset")),
    });

    await harness.wrapPool(rawPool).query("select 1").pipe(Effect.runPromise);

    expect(harness.acquiredPools).toHaveLength(1);

    const acquiredPool = harness.acquiredPools[0];
    expect(acquiredPool).toBeDefined();
    if (!acquiredPool) {
      throw new Error("expected acquired pool");
    }

    await new Promise<void>((resolve) => {
      acquiredPool.connect((error, client, release) => {
        expect(error).toBeInstanceOf(Error);
        expect(error?.message).toBe("connection reset");
        expect(client).toBeDefined();
        expect(typeof client?.on).toBe("function");
        expect(typeof client?.release).toBe("function");
        release();
        resolve();
      });
    });
  });

  test("wrapPool returns the same adapter for the same pool", async () => {
    const harness = createHarness(DefaultRuntimeConfig);
    const rawPool = makePool();

    const first = harness.wrapPool(rawPool);
    const second = harness.wrapPool(rawPool);

    expect(first).toBe(second);

    await first.query("select 1").pipe(Effect.runPromise);
    await second.query("select 1").pipe(Effect.runPromise);

    expect(harness.fromPoolPgClientMock).toHaveBeenCalledTimes(2);
    expect(harness.ownedPoolClientFinalizers()).toBe(2);
    expect(harness.acquiredPools).toHaveLength(2);
    expect(harness.acquiredPools[0]).toBe(harness.acquiredPools[1]);
  });

  test("wrapPool does not create a sql-pg client until first use", () => {
    const harness = createHarness(DefaultRuntimeConfig);
    const rawPool = makePool();

    harness.wrapPool(rawPool);

    expect(harness.fromPoolPgClientMock).not.toHaveBeenCalled();
    expect(harness.ownedPoolClientFinalizers()).toBe(0);
  });
});

function createHarness(
  defaultRuntimeConfig: Layer.Layer<PgRuntimeConfigService>,
) {
  const parseSslConfigMock = mock(
    (...args: unknown[]): Effect.Effect<MockSslConfig, SslConfigError> =>
      Effect.succeed({
        cleanedUrl: args[0] as string,
        ssl: false,
      } satisfies MockSslConfig),
  );
  const createPoolMock = mock((() =>
    makePool({ connect: () => Promise.resolve(makeClient()) })) as (
    ...args: unknown[]
  ) => Pool);
  const endPoolMock = mock(async (_pool: Pool) => {});

  const acquiredPools: Pool[] = [];
  let ownedPoolClientFinalizers = 0;
  const fromPoolPgClientMock = mock(((options: {
    acquire: Effect.Effect<Pool, never, never>;
  }) =>
    options.acquire.pipe(
      Effect.flatMap((pool) => {
        acquiredPools.push(pool);
        return Effect.acquireRelease(
          Effect.succeed(makeSqlPgClientDouble()),
          () =>
            Effect.sync(() => {
              ownedPoolClientFinalizers += 1;
            }),
        );
      }),
    )) as (options: {
    acquire: Effect.Effect<Pool, never, never>;
  }) => Effect.Effect<SqlPgClientDouble, never, Scope.Scope>);

  const databaseLayer = createDatabaseLayer({
    createPool: createPoolMock,
    endPool: endPoolMock,
    parseSslConfig: parseSslConfigMock,
    pgClientFromPool:
      fromPoolPgClientMock as unknown as typeof import("@effect/sql-pg/PgClient").fromPool,
  });

  return {
    acquiredPools,
    createPoolMock,
    fromPoolPgClientMock,
    makeScopedPool: (
      url: string,
      options?: { label?: "source" | "target"; role?: string },
    ) =>
      databaseLayer
        .makeScopedSqlDatabaseEffect(url, options)
        .pipe(
          Effect.provide(defaultRuntimeConfig),
          Effect.provide(NodeFileSystem.layer),
        ),
    makeScopedPoolEffect: databaseLayer.makeScopedSqlDatabaseEffect,
    ownedPoolClientFinalizers: () => ownedPoolClientFinalizers,
    parseSslConfigMock,
    wrapPool: databaseLayer.fromPool,
  };
}

function makeSqlPgClientDouble(): SqlPgClientDouble {
  return {
    reserve: Effect.succeed({
      executeRaw: (_sql: string, _values?: readonly unknown[]) =>
        Effect.succeed({
          command: "SELECT",
          fields: [],
          oid: 0,
          rowCount: 1,
          rows: [{ ok: 1 }],
        }),
    }),
  };
}

function makeClient(): PoolClient {
  const client = {
    off: mock(() => client),
    on: mock(() => client),
    once: mock(() => client),
    processID: 123,
    query: mock(
      (
        _queryTextOrConfig: unknown,
        valuesOrCallback?:
          | readonly unknown[]
          | ((error: Error | undefined, result: QueryResult) => void),
        callback?: (error: Error | undefined, result: QueryResult) => void,
      ) => {
        const handler =
          typeof valuesOrCallback === "function" ? valuesOrCallback : callback;
        handler?.(undefined, {
          command: "SELECT",
          fields: [],
          oid: 0,
          rowCount: 1,
          rows: [{ ok: 1 }],
        });
      },
    ),
    release: mock((_destroy?: unknown) => {}),
    removeListener: mock(() => client),
  };

  return client as unknown as PoolClient;
}

function makePool(options?: {
  connect?: (
    callback?: (
      error: Error | undefined,
      client: PoolClient,
      release: (destroy?: unknown) => void,
    ) => void,
  ) => Promise<PoolClient> | undefined;
}): Pool {
  const connectImpl =
    options?.connect ?? (() => Promise.resolve(makeClient() as PoolClient));

  const pool = {
    connect: mock(
      (
        callback?: (
          error: Error | undefined,
          client: PoolClient,
          release: (destroy?: unknown) => void,
        ) => void,
      ) => {
        const result = connectImpl(callback);
        if (callback && result instanceof Promise) {
          void result.then(
            (client) =>
              callback(undefined, client, (destroy) =>
                client.release(destroy as boolean | Error | undefined),
              ),
            (error) => callback(error as Error, undefined as never, () => {}),
          );
          return;
        }
        return result;
      },
    ),
    end: mock(() => Promise.resolve()),
    ending: false,
    on: mock(() => pool),
    options: undefined,
    query: mock(
      (
        _queryTextOrConfig: unknown,
        valuesOrCallback?:
          | readonly unknown[]
          | ((error: Error | undefined, result: QueryResult) => void),
        callback?: (error: Error | undefined, result: QueryResult) => void,
      ) => {
        const handler =
          typeof valuesOrCallback === "function" ? valuesOrCallback : callback;
        handler?.(undefined, {
          command: "SELECT",
          fields: [],
          oid: 0,
          rowCount: 0,
          rows: [],
        });
        return Promise.resolve({
          command: "SELECT",
          fields: [],
          oid: 0,
          rowCount: 0,
          rows: [],
        });
      },
    ),
    removeListener: mock(() => pool),
    totalCount: 1,
  };

  return pool as unknown as Pool;
}
