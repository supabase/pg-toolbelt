/**
 * A schema-scoped ALTER DEFAULT PRIVILEGES must NOT be exported into the atomic
 * cluster/roles.sql file (PR #307 review #3500714148). It depends on the schema
 * (created in schemas/<schema>/schema.sql), but `schema apply` disables
 * statement reordering whenever an ADP is present, so the raw file-granular
 * loader runs roles.sql as one transaction — the ADP fails on the not-yet-
 * created schema and rolls back CREATE ROLE with it, deadlocking the reload.
 * Routing the schema-scoped ADP into its schema's directory lets the loader's
 * defer-and-retry converge. Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type DependencyEdge, type Fact } from "../core/fact.ts";
import { exportSqlFiles } from "./export-sql-files.ts";

const facts: Fact[] = [
  { id: { kind: "role", name: "alice" }, payload: {} },
  { id: { kind: "schema", name: "app" }, payload: {} },
  {
    id: {
      kind: "defaultPrivilege",
      role: "alice",
      schema: "app",
      objtype: "r",
      grantee: "alice",
    },
    payload: { privileges: ["SELECT"], grantable: [] },
  },
  // a global (schema-null) ADP stays in the role file (no cross-file dep)
  {
    id: {
      kind: "defaultPrivilege",
      role: "alice",
      schema: null,
      objtype: "f",
      grantee: "alice",
    },
    payload: { privileges: ["EXECUTE"], grantable: [] },
  },
];
const edges: DependencyEdge[] = [
  {
    from: { kind: "schema", name: "app" },
    to: { kind: "role", name: "alice" },
    kind: "owner",
  },
];

function fileOf(layout: "by-object" | "grouped", needle: string): string {
  const f = exportSqlFiles(buildFactBase(facts, edges), { layout }).find(
    (file) => file.sql.includes(needle),
  );
  if (f === undefined) throw new Error(`no file contains ${needle}`);
  return f.name;
}

describe("schema-scoped ADP export routing", () => {
  for (const layout of ["by-object", "grouped"] as const) {
    test(`schema-scoped ADP is split out of the role file (${layout})`, () => {
      const name = fileOf(layout, "IN SCHEMA");
      expect(name).not.toBe("_cluster/roles.sql");
      expect(name.startsWith("app/")).toBe(true);
    });

    test(`a global ADP GRANT is not mixed into the role file (${layout})`, () => {
      const name = fileOf(layout, "ON FUNCTIONS");
      expect(name).toBe("_cluster/default_privileges.sql");
    });
  }

  test("by-object overlay wipe file loads after schema.sql and before tables", () => {
    const tableId = {
      kind: "table" as const,
      schema: "app",
      name: "t",
    };
    const files = exportSqlFiles(
      buildFactBase(
        [
          { id: { kind: "role", name: "postgres" }, payload: {} },
          { id: { kind: "schema", name: "app" }, payload: {} },
          {
            id: tableId,
            parent: { kind: "schema", name: "app" },
            payload: { persistence: "p" },
          },
        ],
        [
          {
            from: { kind: "schema", name: "app" },
            to: { kind: "role", name: "postgres" },
            kind: "owner",
          },
          {
            from: tableId,
            to: { kind: "role", name: "postgres" },
            kind: "owner",
          },
        ],
      ),
      {
        assumedRoles: ["anon", "postgres"],
        assumedDefaultGrants: [
          {
            creatingRole: "postgres",
            schema: "app",
            objtype: "r",
            grantee: "anon",
          },
        ],
      },
    );
    const names = files.map((file) => file.name);
    const schemaAt = names.findIndex((n) => n.endsWith("/schema.sql"));
    const wipeAt = names.findIndex((n) => n.endsWith("/adp_wipes.sql"));
    const tableAt = names.findIndex((n) => n.includes("/tables/"));
    const rolesAt = names.findIndex((n) => n.endsWith("/roles.sql"));
    expect(schemaAt).toBeGreaterThanOrEqual(0);
    expect(wipeAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeGreaterThanOrEqual(0);
    expect(schemaAt).toBeLessThan(wipeAt);
    expect(wipeAt).toBeLessThan(tableAt);
    if (rolesAt >= 0) expect(rolesAt).toBeLessThan(wipeAt);
  });

  test("by-object overlay ADP stays after its own schema.sql when another schema has earlier tables", () => {
    const publicTable = {
      kind: "table" as const,
      schema: "public",
      name: "early",
    };
    const appTable = {
      kind: "table" as const,
      schema: "app",
      name: "t",
    };
    const files = exportSqlFiles(
      buildFactBase(
        [
          { id: { kind: "role", name: "postgres" }, payload: {} },
          { id: { kind: "schema", name: "public" }, payload: {} },
          { id: { kind: "schema", name: "app" }, payload: {} },
          {
            id: publicTable,
            parent: { kind: "schema", name: "public" },
            payload: { persistence: "p" },
          },
          {
            id: appTable,
            parent: { kind: "schema", name: "app" },
            payload: { persistence: "p" },
          },
        ],
        [
          {
            from: { kind: "schema", name: "app" },
            to: { kind: "role", name: "postgres" },
            kind: "owner",
          },
          {
            from: publicTable,
            to: { kind: "role", name: "postgres" },
            kind: "owner",
          },
          {
            from: appTable,
            to: { kind: "role", name: "postgres" },
            kind: "owner",
          },
        ],
      ),
      {
        assumedRoles: ["anon", "postgres"],
        assumedDefaultGrants: [
          {
            creatingRole: "postgres",
            schema: "app",
            objtype: "r",
            grantee: "anon",
          },
        ],
      },
    );
    const names = files.map((file) => file.name);
    const appSchemaAt = names.findIndex((n) => n === "app/schema.sql");
    const appWipeAt = names.findIndex((n) => n === "app/adp_wipes.sql");
    const appTableAt = names.findIndex((n) => n.includes("app/tables/"));
    expect(appSchemaAt).toBeGreaterThanOrEqual(0);
    expect(appWipeAt).toBeGreaterThanOrEqual(0);
    expect(appTableAt).toBeGreaterThanOrEqual(0);
    expect(appSchemaAt).toBeLessThan(appWipeAt);
    expect(appWipeAt).toBeLessThan(appTableAt);
  });

  test("by-object table file carries ADP hygiene REVOKE when defaultOwner is set and owner edges are absent", () => {
    const t1 = { kind: "table" as const, schema: "app", name: "t1" };
    const t2 = { kind: "table" as const, schema: "app", name: "t2" };
    const adp = {
      kind: "defaultPrivilege" as const,
      role: "postgres",
      schema: "app",
      objtype: "r",
      grantee: "authenticated",
    };
    const files = exportSqlFiles(
      buildFactBase(
        [
          { id: { kind: "schema", name: "app" }, payload: {} },
          {
            id: t1,
            parent: { kind: "schema", name: "app" },
            payload: { persistence: "p" },
          },
          {
            id: t2,
            parent: { kind: "schema", name: "app" },
            payload: { persistence: "p" },
          },
          {
            id: adp,
            parent: { kind: "schema", name: "app" },
            payload: { privileges: ["SELECT"], grantable: [] },
          },
          {
            id: { kind: "acl", target: t2, grantee: "authenticated" },
            parent: t2,
            payload: { privileges: ["SELECT"], grantable: [] },
          },
        ],
        [],
      ),
      {
        assumedRoles: ["postgres", "authenticated"],
        defaultOwner: "postgres",
      },
    );
    const t1Sql =
      files.find((f) => f.name.includes("app/tables/t1"))?.sql ?? "";
    const t2Sql =
      files.find((f) => f.name.includes("app/tables/t2"))?.sql ?? "";
    expect(t1Sql).toMatch(
      /REVOKE ALL ON TABLE "app"\."t1" FROM "authenticated"/,
    );
    expect(t2Sql).not.toMatch(
      /REVOKE ALL ON TABLE "app"\."t2" FROM "authenticated"/,
    );
  });

  test("by-object overlay wipes load before extensions; GRANT ADP stays after tables", () => {
    const table = { kind: "table" as const, schema: "public", name: "t" };
    const ext = { kind: "extension" as const, name: "pg_trgm" };
    const adp = {
      kind: "defaultPrivilege" as const,
      role: "postgres",
      schema: "public",
      objtype: "r",
      grantee: "authenticated",
    };
    const files = exportSqlFiles(
      buildFactBase(
        [
          { id: { kind: "schema", name: "public" }, payload: {} },
          { id: ext, payload: { schema: "public", _relocatable: true } },
          {
            id: table,
            parent: { kind: "schema", name: "public" },
            payload: { persistence: "p" },
          },
          {
            id: adp,
            parent: { kind: "schema", name: "public" },
            payload: { privileges: ["SELECT"], grantable: [] },
          },
        ],
        [],
      ),
      {
        assumedRoles: ["anon", "postgres", "authenticated"],
        assumedDefaultGrants: [
          {
            creatingRole: "postgres",
            schema: "public",
            objtype: "r",
            grantee: "anon",
          },
          {
            creatingRole: "postgres",
            schema: "public",
            objtype: "r",
            grantee: "authenticated",
          },
        ],
      },
    );
    const names = files.map((file) => file.name);
    const wipeAt = names.findIndex((n) => n.endsWith("/adp_wipes.sql"));
    const grantAt = names.findIndex((n) =>
      n.endsWith("/default_privileges.sql"),
    );
    const tableAt = names.findIndex((n) => n.includes("/tables/"));
    const extAt = names.findIndex((n) => n.includes("/extensions/"));
    expect(wipeAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeGreaterThanOrEqual(0);
    expect(extAt).toBeGreaterThanOrEqual(0);
    expect(wipeAt).toBeLessThan(extAt);
    expect(wipeAt).toBeLessThan(tableAt);
    expect(grantAt).toBeGreaterThan(tableAt);
    const wipeSql = files[wipeAt]!.sql;
    const grantSql = files[grantAt]!.sql;
    expect(wipeSql).toMatch(/REVOKE ALL/);
    expect(wipeSql).not.toMatch(/\bGRANT SELECT\b/);
    expect(grantSql).toMatch(/GRANT SELECT/);
    expect(grantSql).not.toMatch(/REVOKE ALL/);
  });

  test("by-object positive GRANT ADP is not hoisted before a predating table", () => {
    const t1 = { kind: "table" as const, schema: "app", name: "t1" };
    const t2 = { kind: "table" as const, schema: "app", name: "t2" };
    const adp = {
      kind: "defaultPrivilege" as const,
      role: "postgres",
      schema: "app",
      objtype: "S",
      grantee: "rvc_reader",
    };
    const files = exportSqlFiles(
      buildFactBase(
        [
          { id: { kind: "role", name: "rvc_reader" }, payload: {} },
          { id: { kind: "schema", name: "app" }, payload: {} },
          {
            id: t1,
            parent: { kind: "schema", name: "app" },
            payload: { persistence: "p" },
          },
          {
            id: adp,
            parent: { kind: "schema", name: "app" },
            payload: { privileges: ["USAGE"], grantable: [] },
          },
          {
            id: t2,
            parent: { kind: "schema", name: "app" },
            payload: { persistence: "p" },
          },
        ],
        [
          {
            from: { kind: "schema", name: "app" },
            to: { kind: "role", name: "postgres" },
            kind: "owner",
          },
        ],
      ),
      { assumedRoles: ["postgres"] },
    );
    const names = files.map((file) => file.name);
    const grantAt = names.findIndex((n) =>
      n.endsWith("/default_privileges.sql"),
    );
    const t1At = names.findIndex((n) => n.includes("app/tables/t1"));
    expect(grantAt).toBeGreaterThanOrEqual(0);
    expect(t1At).toBeGreaterThanOrEqual(0);
    expect(t1At).toBeLessThan(grantAt);
    expect(files[grantAt]!.sql).toMatch(/GRANT USAGE/);
    expect(files[grantAt]!.sql).not.toMatch(/REVOKE ALL/);
  });

  test("by-object global overlay wipe is not after the matching GRANT in roles.sql", () => {
    const adp = {
      kind: "defaultPrivilege" as const,
      role: "postgres",
      schema: null,
      objtype: "r",
      grantee: "anon",
    };
    const files = exportSqlFiles(
      buildFactBase(
        [
          { id: { kind: "schema", name: "public" }, payload: {} },
          { id: adp, payload: { privileges: ["SELECT"], grantable: [] } },
          {
            id: { kind: "table" as const, schema: "public", name: "t" },
            parent: { kind: "schema", name: "public" },
            payload: { persistence: "p" },
          },
        ],
        [],
      ),
      {
        assumedRoles: ["postgres", "anon"],
        assumedDefaultGrants: [
          {
            creatingRole: "postgres",
            schema: null,
            objtype: "r",
            grantee: "anon",
          },
        ],
      },
    );
    const names = files.map((file) => file.name);
    const wipeAt = names.findIndex((n) => n === "_cluster/adp_wipes.sql");
    const grantAt = names.findIndex(
      (n) => n === "_cluster/default_privileges.sql",
    );
    const rolesAt = names.findIndex((n) => n.endsWith("/roles.sql"));
    const tableAt = names.findIndex((n) => n.includes("/tables/"));
    expect(wipeAt).toBeGreaterThanOrEqual(0);
    expect(grantAt).toBeGreaterThanOrEqual(0);
    expect(wipeAt).toBeLessThan(grantAt);
    if (rolesAt >= 0) expect(rolesAt).toBeLessThan(wipeAt);
    if (tableAt >= 0) expect(wipeAt).toBeLessThan(tableAt);
    expect(files[wipeAt]!.sql).toMatch(/REVOKE ALL/);
    expect(files[grantAt]!.sql).toMatch(/GRANT SELECT/);
    expect(files[grantAt]!.sql).not.toMatch(/REVOKE ALL/);
    const rolesSql = rolesAt >= 0 ? files[rolesAt]!.sql : "";
    expect(rolesSql).not.toMatch(/ALTER DEFAULT PRIVILEGES/);
  });
});
