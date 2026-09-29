/**
 * A schema-scoped ALTER DEFAULT PRIVILEGES must not share atomic roles.sql with
 * CREATE ROLE: any ADP disables statement reorder, so a failed IN SCHEMA
 * statement would roll the role back. File it under the schema instead.
 * Global GRANT ADP is a sibling cluster file. Pure — no DB.
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
  // global GRANT ADP is a sibling cluster file, not mixed into roles.sql
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

  test("overlay ADP stays after its own schema.sql when another schema has earlier tables", () => {
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

  test("positive GRANT ADP is not hoisted before a predating table", () => {
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

  test("by-object global overlay wipe loads before the matching GRANT ADP", () => {
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

  test("by-object desired REVOKE ALL is not hoisted before CREATE EXTENSION", () => {
    const ext = { kind: "extension" as const, name: "pg_trgm" };
    const adp = {
      kind: "defaultPrivilege" as const,
      role: "postgres",
      schema: "public",
      objtype: "f",
      grantee: "PUBLIC",
    };
    const files = exportSqlFiles(
      buildFactBase(
        [
          { id: { kind: "schema", name: "public" }, payload: {} },
          { id: ext, payload: { schema: "public", _relocatable: true } },
          {
            id: adp,
            parent: { kind: "schema", name: "public" },
            payload: {
              privileges: [],
              grantable: [],
              _revokedDefault: ["EXECUTE"],
            },
          },
        ],
        [],
      ),
      { assumedRoles: ["postgres"] },
    );
    const names = files.map((file) => file.name);
    expect(names.findIndex((n) => n.endsWith("/adp_wipes.sql"))).toBe(-1);
    const revokeAt = names.findIndex((n) =>
      n.endsWith("/default_privileges.sql"),
    );
    const extAt = names.findIndex((n) => n.includes("/extensions/"));
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(extAt).toBeGreaterThanOrEqual(0);
    expect(extAt).toBeLessThan(revokeAt);
    expect(files[revokeAt]!.sql).toMatch(/REVOKE ALL ON FUNCTIONS FROM PUBLIC/);
  });

  test.each(["by-object", "ordered", "grouped"] as const)(
    "%s overlay wipes before extensions/tables; GRANT ADP after; wipe file named adp_wipes",
    (layout) => {
      const files = overlayWipeGrantFiles(layout);
      const names = files.map((f) => f.name.replaceAll("\\", "/"));
      const wipeAt = names.findIndex((n) => n.endsWith("adp_wipes.sql"));
      const grantAt = names.findIndex((n) =>
        n.endsWith("default_privileges.sql"),
      );
      const extAt = files.findIndex((f) => /CREATE EXTENSION/.test(f.sql));
      const tableAt = files.findIndex((f) => /CREATE TABLE/.test(f.sql));
      expect(wipeAt).toBeGreaterThanOrEqual(0);
      expect(grantAt).toBeGreaterThanOrEqual(0);
      expect(extAt).toBeGreaterThanOrEqual(0);
      expect(tableAt).toBeGreaterThanOrEqual(0);
      expect(wipeAt).toBeLessThan(extAt);
      expect(wipeAt).toBeLessThan(tableAt);
      expect(grantAt).toBeGreaterThan(tableAt);
      expect(files[wipeAt]!.sql).toMatch(
        /^-- Clears assumed destination defaults/,
      );
      expect(files[wipeAt]!.sql).toMatch(/REVOKE ALL ON TABLES FROM "anon"/);
      expect(files[wipeAt]!.sql).not.toMatch(/\bGRANT SELECT\b/);
      expect(files[grantAt]!.sql).toMatch(/\bGRANT SELECT\b/);
      expect(files[grantAt]!.sql).not.toMatch(/REVOKE ALL/);
    },
  );
});

function overlayWipeGrantFiles(
  layout: "by-object" | "ordered" | "grouped",
): ReturnType<typeof exportSqlFiles> {
  const table = { kind: "table" as const, schema: "public", name: "t" };
  const ext = { kind: "extension" as const, name: "pg_trgm" };
  const adp = {
    kind: "defaultPrivilege" as const,
    role: "postgres",
    schema: "public",
    objtype: "r",
    grantee: "authenticated",
  };
  return exportSqlFiles(
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
      layout,
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
}
