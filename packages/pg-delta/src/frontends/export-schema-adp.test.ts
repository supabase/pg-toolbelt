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

    test(`a global ADP stays in the role file (${layout})`, () => {
      // the FUNCTIONS (objtype f) ADP has no schema — keep it with the roles
      const name = fileOf(layout, "ON FUNCTIONS");
      expect(name).toBe("_cluster/roles.sql");
    });
  }

  test("by-object overlay ADP file loads after schema.sql and before tables", () => {
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
    const adpAt = names.findIndex((n) => n.endsWith("/default_privileges.sql"));
    const tableAt = names.findIndex((n) => n.includes("/tables/"));
    const rolesAt = names.findIndex((n) => n.endsWith("/roles.sql"));
    expect(schemaAt).toBeGreaterThanOrEqual(0);
    expect(adpAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeGreaterThanOrEqual(0);
    expect(schemaAt).toBeLessThan(adpAt);
    expect(adpAt).toBeLessThan(tableAt);
    if (rolesAt >= 0) expect(rolesAt).toBeLessThan(adpAt);
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
    const appAdpAt = names.findIndex((n) => n === "app/default_privileges.sql");
    const appTableAt = names.findIndex((n) => n.includes("app/tables/"));
    expect(appSchemaAt).toBeGreaterThanOrEqual(0);
    expect(appAdpAt).toBeGreaterThanOrEqual(0);
    expect(appTableAt).toBeGreaterThanOrEqual(0);
    expect(appSchemaAt).toBeLessThan(appAdpAt);
    expect(appAdpAt).toBeLessThan(appTableAt);
  });
});
