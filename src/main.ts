import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import {
  createPgliteAdapter,
  type DbConnection,
  isPgliteConnection,
} from "./adapter.ts";
import { diffCatalogs } from "./catalog.diff.ts";
import type { Catalog } from "./catalog.model.ts";
import { extractCatalog } from "./catalog.model.ts";
import type { Change } from "./change.types.ts";
import { sortChanges } from "./sort/phased-graph-sort.ts";

// Custom type handler for specifics corner cases
export const postgresConfig: postgres.Options<
  Record<string, postgres.PostgresType>
> = {
  types: {
    int2vector: {
      // The pg_types oid for int2vector (22 is the OID for int2vector)
      to: 22,
      // Array of pg_types oids to handle when parsing values coming from the db
      from: [22],
      // Parse int2vector from string format "1 2 3" to array [1, 2, 3]
      parse: (value: string) => {
        if (!value || value === "") return [];
        return value
          .split(" ")
          .map(Number)
          .filter((n) => !Number.isNaN(n));
      },
      // Serialize array back to int2vector format if needed
      serialize: (value: number[]) => {
        if (!Array.isArray(value)) return "";
        return value.join(" ");
      },
    },
    // Handle bigint values from PostgreSQL
    bigint: {
      // The pg_types oid for bigint (20 is the OID for int8/bigint)
      to: 20,
      // Array of pg_types oids to handle when parsing values coming from the db
      from: [20],
      // Parse bigint string to JavaScript BigInt
      parse: (value: string) => {
        return BigInt(value);
      },
      // Serialize BigInt back to string for PostgreSQL
      serialize: (value: bigint) => {
        return value.toString();
      },
    },
  },
};

export interface DiffContext {
  mainCatalog: Catalog;
  branchCatalog: Catalog;
}

export type ChangeFilter = (ctx: DiffContext, change: Change) => boolean;

export type ChangeSerializer = (
  ctx: DiffContext,
  change: Change
) => string | undefined;

export interface MainOptions {
  filter?: ChangeFilter;
  serialize?: ChangeSerializer;
}

export async function diff(
  mainDatabaseConnection: DbConnection,
  branchDatabaseConnection: DbConnection,
  options: MainOptions = {}
) {
  // Create adapters based on connection type
  let mainAdapter: postgres.Sql;
  let branchAdapter: postgres.Sql;

  if (isPgliteConnection(mainDatabaseConnection)) {
    mainAdapter = createPgliteAdapter(mainDatabaseConnection);
  } else {
    mainAdapter = postgres(mainDatabaseConnection, postgresConfig);
  }

  if (isPgliteConnection(branchDatabaseConnection)) {
    branchAdapter = createPgliteAdapter(branchDatabaseConnection);
  } else {
    branchAdapter = postgres(branchDatabaseConnection, postgresConfig);
  }

  const [mainCatalog, branchCatalog] = await Promise.all([
    extractCatalog(mainAdapter),
    extractCatalog(branchAdapter),
  ]);

  // await Promise.all([mainAdapter.end(), branchAdapter.end()]);

  const changes = diffCatalogs(mainCatalog, branchCatalog);

  const filteredChanges = options.filter
    ? changes.filter((change) =>
        // biome-ignore lint/style/noNonNullAssertion: options.filter is guaranteed to be defined
        options.filter!({ mainCatalog, branchCatalog }, change)
      )
    : changes;

  if (filteredChanges.length === 0) {
    return [];
  }

  const sortedChanges = sortChanges(
    { mainCatalog, branchCatalog },
    filteredChanges
  );
  // return sortedChanges;
  // Filter out dropping of roles and creation of extensions
  return sortedChanges.filter(
    (change) =>
      !(
        (change.objectType === "role" && change.operation === "drop") ||
        (change.objectType === "extension" && change.operation === "create")
      )
  );
}

export function createMigrationFromDiff(
  changes: Change[],
  ctx: DiffContext,
  options: MainOptions = {}
): string {
  const hasRoutineChanges = changes.some(
    (change) =>
      change.objectType === "procedure" || change.objectType === "aggregate"
  );
  const sessionConfig = hasRoutineChanges
    ? ["SET check_function_bodies = false"]
    : [];

  const migrationScript = [
    ...sessionConfig,
    ...changes.map((change) => {
      return options.serialize?.(ctx, change) ?? change.serialize();
    }),
  ].join(";\n\n");

  return migrationScript;
}
