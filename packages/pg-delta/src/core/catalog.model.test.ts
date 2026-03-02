import { describe, expect, test } from "bun:test";
import { createEmptyCatalog } from "./catalog.model.ts";

describe("createEmptyCatalog", () => {
  test("PG < 15 returns a minimal catalog with only a public schema", async () => {
    const catalog = await createEmptyCatalog(140000, "myuser");

    // version and currentUser forwarded
    expect(catalog.version).toBe(140000);
    expect(catalog.currentUser).toBe("myuser");

    // public schema owned by the provided currentUser (pre-PG15 behavior)
    const publicSchema = catalog.schemas["schema:public"];
    expect(publicSchema).toBeDefined();
    expect(publicSchema.owner).toBe("myuser");

    // everything else is empty
    expect(Object.keys(catalog.schemas)).toEqual(["schema:public"]);
    const emptyRecords = [
      catalog.aggregates,
      catalog.collations,
      catalog.compositeTypes,
      catalog.domains,
      catalog.enums,
      catalog.extensions,
      catalog.procedures,
      catalog.indexes,
      catalog.materializedViews,
      catalog.subscriptions,
      catalog.publications,
      catalog.rlsPolicies,
      catalog.roles,
      catalog.sequences,
      catalog.tables,
      catalog.triggers,
      catalog.eventTriggers,
      catalog.rules,
      catalog.ranges,
      catalog.views,
      catalog.foreignDataWrappers,
      catalog.servers,
      catalog.userMappings,
      catalog.foreignTables,
      catalog.indexableObjects,
    ];
    for (const record of emptyRecords) {
      expect(record).toEqual({});
    }
    expect(catalog.depends).toEqual([]);
  });

  test("PG 15-16 returns a full baseline catalog from snapshot", async () => {
    const catalog = await createEmptyCatalog(160004, "admin_user");

    // version and currentUser forwarded (not hardcoded from JSON)
    expect(catalog.version).toBe(160004);
    expect(catalog.currentUser).toBe("admin_user");

    // public schema with pg_database_owner (PG 15+ default) and ACLs
    const publicSchema = catalog.schemas["schema:public"];
    expect(publicSchema.owner).toBe("pg_database_owner");
    expect(publicSchema.privileges.length).toBeGreaterThan(0);

    // plpgsql extension pre-installed
    expect(catalog.extensions["extension:plpgsql"]).toBeDefined();
    expect(catalog.extensions["extension:plpgsql"].name).toBe("plpgsql");

    // postgres superuser role with default privileges
    const role = catalog.roles["role:postgres"];
    expect(role.name).toBe("postgres");
    expect(role.is_superuser).toBe(true);
    expect(role.default_privileges.length).toBeGreaterThan(0);

    // no MAINTAIN privilege (PG 17+ only)
    const relPrivs = role.default_privileges.find(
      (dp) => dp.objtype === "r" && dp.grantee === "postgres",
    );
    expect(relPrivs).toBeDefined();
    expect(relPrivs?.privileges.map((p) => p.privilege)).not.toContain(
      "MAINTAIN",
    );

    // dependency graph populated
    expect(catalog.depends.length).toBeGreaterThan(0);
  });

  test("PG 17 baseline adds MAINTAIN privilege to default relation grants", async () => {
    const catalog = await createEmptyCatalog(170009, "admin_user");

    // version and currentUser forwarded
    expect(catalog.version).toBe(170009);
    expect(catalog.currentUser).toBe("admin_user");

    // same baseline objects as PG 15-16
    expect(catalog.extensions["extension:plpgsql"]).toBeDefined();
    expect(catalog.roles["role:postgres"]).toBeDefined();
    expect(catalog.depends.length).toBeGreaterThan(0);

    // MAINTAIN privilege present and in alphabetical order
    const relPrivs = catalog.roles["role:postgres"].default_privileges.find(
      (dp) => dp.objtype === "r" && dp.grantee === "postgres",
    );
    expect(relPrivs).toBeDefined();
    const privNames = relPrivs?.privileges.map((p) => p.privilege) ?? [];
    expect(privNames).toContain("MAINTAIN");
    expect(privNames).toEqual([...privNames].sort());
  });

  test("PG 17 patching does not mutate the cached PG 15-16 baseline", async () => {
    // force PG 17 baseline to be built first
    await createEmptyCatalog(170000, "postgres");

    const pg16 = await createEmptyCatalog(160000, "postgres");
    const relPrivs = pg16.roles["role:postgres"].default_privileges.find(
      (dp) => dp.objtype === "r" && dp.grantee === "postgres",
    );
    expect(relPrivs).toBeDefined();
    expect(relPrivs?.privileges.map((p) => p.privilege)).not.toContain(
      "MAINTAIN",
    );
  });

  test("patched PG 17 baseline matches the reference PG 17 snapshot", async () => {
    const { deserializeCatalog, serializeCatalog } = await import(
      "./catalog.snapshot.ts"
    );
    const pg17Json = (
      await import("./fixtures/empty-catalogs/postgres-17-baseline.json")
    ).default;

    const fromSnapshot = deserializeCatalog(pg17Json);
    const fromPatch = await createEmptyCatalog(
      fromSnapshot.version,
      fromSnapshot.currentUser,
    );

    expect(serializeCatalog(fromPatch)).toEqual(
      serializeCatalog(fromSnapshot),
    );
  });
});
