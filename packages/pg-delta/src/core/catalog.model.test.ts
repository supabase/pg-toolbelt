import { describe, expect, test } from "bun:test";
import { createEmptyCatalog } from "./catalog.model.ts";

describe("createEmptyCatalog", () => {
  describe("PG < 15 (inline fallback)", () => {
    test("all object records are empty except schemas", async () => {
      const catalog = await createEmptyCatalog(140000, "postgres");

      expect(catalog.aggregates).toEqual({});
      expect(catalog.collations).toEqual({});
      expect(catalog.compositeTypes).toEqual({});
      expect(catalog.domains).toEqual({});
      expect(catalog.enums).toEqual({});
      expect(catalog.extensions).toEqual({});
      expect(catalog.procedures).toEqual({});
      expect(catalog.indexes).toEqual({});
      expect(catalog.materializedViews).toEqual({});
      expect(catalog.subscriptions).toEqual({});
      expect(catalog.publications).toEqual({});
      expect(catalog.rlsPolicies).toEqual({});
      expect(catalog.roles).toEqual({});
      expect(catalog.sequences).toEqual({});
      expect(catalog.tables).toEqual({});
      expect(catalog.triggers).toEqual({});
      expect(catalog.eventTriggers).toEqual({});
      expect(catalog.rules).toEqual({});
      expect(catalog.ranges).toEqual({});
      expect(catalog.views).toEqual({});
      expect(catalog.foreignDataWrappers).toEqual({});
      expect(catalog.servers).toEqual({});
      expect(catalog.userMappings).toEqual({});
      expect(catalog.foreignTables).toEqual({});
      expect(catalog.depends).toEqual([]);
      expect(catalog.indexableObjects).toEqual({});
    });

    test("public schema uses currentUser as owner", async () => {
      const catalog = await createEmptyCatalog(140000, "myuser");

      const publicSchema = catalog.schemas["schema:public"];
      expect(publicSchema).toBeDefined();
      expect(publicSchema.owner).toBe("myuser");
    });
  });

  describe("PG 15-16 (baseline)", () => {
    test("version and currentUser are set from arguments", async () => {
      const catalog = await createEmptyCatalog(150000, "admin_user");

      expect(catalog.version).toBe(150000);
      expect(catalog.currentUser).toBe("admin_user");
    });

    test("public schema is pre-populated with pg_database_owner", async () => {
      const catalog = await createEmptyCatalog(160000, "postgres");

      const publicSchema = catalog.schemas["schema:public"];
      expect(publicSchema).toBeDefined();
      expect(publicSchema.name).toBe("public");
      expect(publicSchema.owner).toBe("pg_database_owner");
      expect(publicSchema.comment).toBe("standard public schema");
    });

    test("includes plpgsql extension", async () => {
      const catalog = await createEmptyCatalog(160000, "postgres");

      expect(catalog.extensions["extension:plpgsql"]).toBeDefined();
      expect(catalog.extensions["extension:plpgsql"].name).toBe("plpgsql");
    });

    test("includes postgres role with default privileges", async () => {
      const catalog = await createEmptyCatalog(160000, "postgres");

      const role = catalog.roles["role:postgres"];
      expect(role).toBeDefined();
      expect(role.name).toBe("postgres");
      expect(role.is_superuser).toBe(true);
    });

    test("includes depends", async () => {
      const catalog = await createEmptyCatalog(160000, "postgres");

      expect(catalog.depends.length).toBeGreaterThan(0);
    });

    test("does not include MAINTAIN privilege in default relation privileges", async () => {
      const catalog = await createEmptyCatalog(160000, "postgres");

      const role = catalog.roles["role:postgres"];
      const relPrivs = role.default_privileges.find(
        (dp) => dp.objtype === "r" && dp.grantee === "postgres",
      );
      expect(relPrivs).toBeDefined();
      const privNames = relPrivs!.privileges.map((p) => p.privilege);
      expect(privNames).not.toContain("MAINTAIN");
    });
  });

  describe("PG 17+ (patched baseline)", () => {
    test("version and currentUser are set from arguments", async () => {
      const catalog = await createEmptyCatalog(170000, "admin_user");

      expect(catalog.version).toBe(170000);
      expect(catalog.currentUser).toBe("admin_user");
    });

    test("includes plpgsql extension", async () => {
      const catalog = await createEmptyCatalog(170000, "postgres");

      expect(catalog.extensions["extension:plpgsql"]).toBeDefined();
    });

    test("includes MAINTAIN privilege in default relation privileges", async () => {
      const catalog = await createEmptyCatalog(170000, "postgres");

      const role = catalog.roles["role:postgres"];
      const relPrivs = role.default_privileges.find(
        (dp) => dp.objtype === "r" && dp.grantee === "postgres",
      );
      expect(relPrivs).toBeDefined();
      const privNames = relPrivs!.privileges.map((p) => p.privilege);
      expect(privNames).toContain("MAINTAIN");
    });

    test("MAINTAIN privilege is in correct alphabetical position", async () => {
      const catalog = await createEmptyCatalog(170000, "postgres");

      const role = catalog.roles["role:postgres"];
      const relPrivs = role.default_privileges.find(
        (dp) => dp.objtype === "r" && dp.grantee === "postgres",
      );
      const privNames = relPrivs!.privileges.map((p) => p.privilege);
      const maintainIdx = privNames.indexOf("MAINTAIN");
      const insertIdx = privNames.indexOf("INSERT");
      const refsIdx = privNames.indexOf("REFERENCES");
      expect(maintainIdx).toBeGreaterThan(insertIdx);
      expect(maintainIdx).toBeLessThan(refsIdx);
    });

    test("PG 17 patching does not mutate PG 15-16 baseline", async () => {
      await createEmptyCatalog(170000, "postgres");
      const pg16 = await createEmptyCatalog(160000, "postgres");

      const role = pg16.roles["role:postgres"];
      const relPrivs = role.default_privileges.find(
        (dp) => dp.objtype === "r" && dp.grantee === "postgres",
      );
      const privNames = relPrivs!.privileges.map((p) => p.privilege);
      expect(privNames).not.toContain("MAINTAIN");
    });
  });
});
