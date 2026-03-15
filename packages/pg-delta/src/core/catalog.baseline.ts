import { Effect } from "effect";
import { Catalog } from "./catalog.ts";
import { Schema } from "./objects/schema/schema.model.ts";

// Lazily cached deserialized baselines (shared across calls)
let _pg1516Baseline: Catalog | null = null;
let _pg17Baseline: Catalog | null = null;

const loadBaselineJson = Effect.promise(() =>
  import("./fixtures/empty-catalogs/postgres-15-16-baseline.json").then(
    (mod) => mod.default as Record<string, unknown>,
  ),
);

const getPg1516Baseline: Effect.Effect<Catalog> = Effect.suspend(() => {
  if (_pg1516Baseline) return Effect.succeed(_pg1516Baseline);
  return Effect.gen(function* () {
    const { deserializeCatalog } = yield* Effect.promise(() =>
      import("./catalog.snapshot.ts"),
    );
    const json = yield* loadBaselineJson;
    _pg1516Baseline = deserializeCatalog(json);
    return _pg1516Baseline;
  });
});

const getPg17Baseline: Effect.Effect<Catalog> = Effect.suspend(() => {
  if (_pg17Baseline) return Effect.succeed(_pg17Baseline);
  return Effect.gen(function* () {
    const { deserializeCatalog } = yield* Effect.promise(() =>
      import("./catalog.snapshot.ts"),
    );
    // PG 17 is identical to PG 15-16 except for a single addition:
    // the MAINTAIN privilege on default relation (objtype "r") privileges.
    // We patch the 15-16 baseline to avoid shipping a second full JSON file.
    const json = yield* loadBaselineJson;
    const patched = structuredClone(json);
    const roles = patched.roles as
      | Record<string, Record<string, unknown>>
      | undefined;
    const pgRole = roles?.["role:postgres"];
    if (pgRole) {
      const defaultPrivileges = pgRole.default_privileges as Array<{
        objtype: string;
        grantee: string;
        privileges: Array<{ privilege: string; grantable: boolean }>;
      }>;
      const relPrivs = defaultPrivileges?.find(
        (dp) => dp.objtype === "r" && dp.grantee === "postgres",
      );
      if (relPrivs) {
        const insertIdx = relPrivs.privileges.findIndex(
          (p) => p.privilege === "INSERT",
        );
        if (insertIdx === -1) {
          return yield* Effect.die(
            new Error(
              "PG17 baseline patch failed: INSERT privilege not found in default relation privileges",
            ),
          );
        }
        relPrivs.privileges.splice(insertIdx + 1, 0, {
          privilege: "MAINTAIN",
          grantable: false,
        });
      }
    }
    _pg17Baseline = deserializeCatalog(patched);
    return _pg17Baseline;
  });
});

/**
 * Create a baseline catalog representing a fresh PostgreSQL database.
 *
 * For PG 15+ this deserializes a pre-extracted snapshot of an empty `template1`
 * database, including the `plpgsql` extension, `postgres` role with default
 * privileges, and the `public` schema with its default ACLs and depends.
 *
 * For PG < 15, falls back to a minimal inline catalog with only the `public`
 * schema. For exact fidelity on older versions, snapshot a real reference
 * database using `serializeCatalog` and pass the deserialized result as source
 * to `createPlan`.
 */
export const createEmptyCatalog = (
  version: number,
  currentUser: string,
): Effect.Effect<Catalog> =>
  Effect.gen(function* () {
    if (version >= 170000) {
      const baseline = yield* getPg17Baseline;
      return new Catalog({ ...baseline, version, currentUser });
    }
    if (version >= 150000) {
      const baseline = yield* getPg1516Baseline;
      return new Catalog({ ...baseline, version, currentUser });
    }

    const publicSchema = new Schema({
      name: "public",
      owner: currentUser,
      comment: "standard public schema",
      privileges: [],
    });

    return new Catalog({
      aggregates: {},
      collations: {},
      compositeTypes: {},
      domains: {},
      enums: {},
      extensions: {},
      procedures: {},
      indexes: {},
      materializedViews: {},
      subscriptions: {},
      publications: {},
      rlsPolicies: {},
      roles: {},
      schemas: { [publicSchema.stableId]: publicSchema },
      sequences: {},
      tables: {},
      triggers: {},
      eventTriggers: {},
      rules: {},
      ranges: {},
      views: {},
      foreignDataWrappers: {},
      servers: {},
      userMappings: {},
      foreignTables: {},
      depends: [],
      indexableObjects: {},
      version,
      currentUser,
    });
  });
