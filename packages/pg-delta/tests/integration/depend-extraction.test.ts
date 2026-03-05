/**
 * Integration tests that exercise extractDepends (depend.ts) by creating
 * a rich schema so more dependency branches (object deps, ACLs, default
 * privileges, memberships) are present when extractCatalog runs.
 */

import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbIsolated } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`depend extraction (pg${pgVersion})`, () => {
    test(
      "extractCatalog returns depends with object and privilege edges for rich schema",
      withDbIsolated(pgVersion, async (db) => {
        await db.branch.query(`CREATE ROLE parent_role_dep`);
        await db.branch.query(dedent`
          CREATE SCHEMA dep_schema;
          CREATE TABLE dep_schema.tab (id int);
          CREATE VIEW dep_schema.vw AS SELECT * FROM dep_schema.tab;
          CREATE SEQUENCE dep_schema.seq;
          CREATE MATERIALIZED VIEW dep_schema.mv AS SELECT 1 AS x;
          CREATE ROLE dep_role_a;
          CREATE ROLE dep_role_b;
          GRANT SELECT ON dep_schema.tab TO dep_role_a;
          GRANT SELECT ON dep_schema.vw TO dep_role_b;
          GRANT USAGE ON SEQUENCE dep_schema.seq TO dep_role_a;
          GRANT parent_role_dep TO dep_role_b;
        `);
        await db.branch.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA dep_schema GRANT SELECT ON TABLES TO dep_role_a`,
        );

        const catalog = await extractCatalog(db.branch);

        expect(catalog.depends).toBeDefined();
        expect(Array.isArray(catalog.depends)).toBe(true);
        expect(catalog.depends.length).toBeGreaterThan(0);

        const dependentIds = new Set(
          catalog.depends.map((d) => d.dependent_stable_id),
        );
        const referencedIds = new Set(
          catalog.depends.map((d) => d.referenced_stable_id),
        );

        expect(dependentIds.has("view:dep_schema.vw") || referencedIds.has("view:dep_schema.vw")).toBe(true);
        expect(dependentIds.has("table:dep_schema.tab") || referencedIds.has("table:dep_schema.tab")).toBe(true);

        const aclOrDefaclOrMembership = catalog.depends.filter(
          (d) =>
            d.dependent_stable_id.startsWith("acl:") ||
            d.dependent_stable_id.startsWith("aclcol:") ||
            d.dependent_stable_id.startsWith("defacl:") ||
            d.dependent_stable_id.startsWith("membership:"),
        );
        expect(aclOrDefaclOrMembership.length).toBeGreaterThan(0);
      }),
    );

    test(
      "extractCatalog from main and branch both populate depends",
      withDbIsolated(pgVersion, async (db) => {
        await db.main.query(dedent`
          CREATE SCHEMA s1;
          CREATE TABLE s1.t1 (a int);
          CREATE ROLE r1;
          GRANT SELECT ON s1.t1 TO r1;
        `);
        await db.branch.query(dedent`
          CREATE SCHEMA s1;
          CREATE TABLE s1.t1 (a int);
          CREATE ROLE r1;
          GRANT SELECT ON s1.t1 TO r1;
        `);

        const [mainCatalog, branchCatalog] = await Promise.all([
          extractCatalog(db.main),
          extractCatalog(db.branch),
        ]);

        expect(mainCatalog.depends.length).toBeGreaterThan(0);
        expect(branchCatalog.depends.length).toBeGreaterThan(0);
      }),
    );
  });
}
