import { type Effect, ServiceMap } from "effect";
import type { Pool } from "pg";
import type { CatalogExtractionError } from "../errors.ts";

export interface DatabaseApi {
  /** Execute a parameterized query */
  readonly query: <R = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ) => Effect.Effect<
    { rows: R[]; rowCount: number | null },
    CatalogExtractionError
  >;
  /** Access the underlying pg Pool (escape hatch for code not yet migrated) */
  readonly getPool: () => Pool;
}

export class DatabaseService extends ServiceMap.Service<
  DatabaseService,
  DatabaseApi
>()("@pg-delta/DatabaseService") {}
