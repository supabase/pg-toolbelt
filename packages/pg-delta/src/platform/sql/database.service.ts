import type * as PgClient from "@effect/sql-pg/PgClient";
import { Effect, ServiceMap } from "effect";
import type { Connection as SqlConnection } from "effect/unstable/sql/SqlConnection";
import {
  CatalogExtractionError,
  type ConnectionError,
} from "../../core/errors.ts";
import { ensureError } from "../../utils.ts";
import { ConnectionError as SqlConnectionError } from "./errors.ts";

export type QueryInput = string | { text: string; values?: readonly unknown[] };

export interface QueryResult<R = Record<string, unknown>> {
  readonly rows: R[];
  readonly rowCount: number | null;
}

export interface DatabaseConnectionApi {
  readonly query: <R = Record<string, unknown>>(
    query: QueryInput,
    values?: readonly unknown[],
  ) => Effect.Effect<QueryResult<R>, CatalogExtractionError>;
}

export interface DatabaseApi extends DatabaseConnectionApi {
  readonly withConnection: <A, E, R>(
    use: (connection: DatabaseConnectionApi) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ConnectionError | CatalogExtractionError, R>;
}

export class SqlDatabase extends ServiceMap.Service<SqlDatabase, DatabaseApi>()(
  "@pg-delta/platform/sql/SqlDatabase",
) {}

const makeDatabaseConnection = (
  connection: SqlConnection,
  onError: (error: unknown) => CatalogExtractionError,
): DatabaseConnectionApi => ({
  query: <R = Record<string, unknown>>(
    query: QueryInput,
    values?: readonly unknown[],
  ) =>
    connection
      .executeRaw(
        typeof query === "string" ? query : query.text,
        (typeof query === "string" ? values : (query.values ?? values)) ?? [],
      )
      .pipe(Effect.map(normalizeRawResult<R>), Effect.mapError(onError)),
});

export const fromPgClient = (
  client: PgClient.PgClient,
  options?: {
    readonly queryError?: (error: unknown) => CatalogExtractionError;
    readonly connectionError?: (error: unknown) => ConnectionError;
    readonly prepareConnection?: (
      connection: DatabaseConnectionApi,
    ) => Effect.Effect<void, CatalogExtractionError>;
  },
): DatabaseApi => {
  const queryError =
    options?.queryError ??
    ((error: unknown) =>
      new CatalogExtractionError({
        message:
          error instanceof Error
            ? error.message
            : "Database query failed during catalog extraction.",
        cause: error,
      }));
  const connectionError =
    options?.connectionError ??
    ((error) =>
      new SqlConnectionError({
        label: "target",
        message:
          error instanceof Error
            ? error.message
            : "Database connection failed.",
        cause: ensureError(error),
      }));
  const prepareConnection = options?.prepareConnection ?? (() => Effect.void);

  return {
    query: <R = Record<string, unknown>>(
      query: QueryInput,
      values?: readonly unknown[],
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* client.reserve.pipe(
            Effect.mapError(queryError),
          );
          const dbConnection = makeDatabaseConnection(connection, queryError);
          yield* prepareConnection(dbConnection);
          return yield* dbConnection.query<R>(query, values);
        }),
      ),
    withConnection: <A, E, R>(
      use: (connection: DatabaseConnectionApi) => Effect.Effect<A, E, R>,
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const connection = yield* client.reserve.pipe(
            Effect.mapError(connectionError),
          );
          const dbConnection = makeDatabaseConnection(connection, queryError);
          yield* prepareConnection(dbConnection);
          return yield* use(dbConnection);
        }),
      ),
  };
};

function isQueryResult(
  raw: unknown,
): raw is { rows?: unknown[]; rowCount?: number | null } {
  return typeof raw === "object" && raw !== null && "rows" in raw;
}

function normalizeRawResult<R>(raw: unknown): QueryResult<R> {
  if (Array.isArray(raw)) {
    const last = raw[raw.length - 1];
    if (isQueryResult(last)) {
      return {
        rows: (last.rows ?? []) as R[],
        rowCount: last.rowCount ?? null,
      };
    }
    return { rows: [], rowCount: null };
  }

  if (isQueryResult(raw)) {
    return {
      rows: (raw.rows ?? []) as R[],
      rowCount: raw.rowCount ?? null,
    };
  }

  return {
    rows: [],
    rowCount: null,
  };
}
