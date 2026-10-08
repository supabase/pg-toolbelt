/**
 * A customization of the pre-existing `public` schema (a non-default ACL such as
 * REVOKE CREATE ON SCHEMA public FROM PUBLIC, or a changed COMMENT) must be
 * EXPORTED. The export baseline seeds `public`'s existence — not its live
 * acl/comment — so these facts diff against a pristine baseline like every other
 * schema and are emitted, instead of being masked by a same-valued baseline.
 * A grant a fresh public carries that live revoked is seeded, so it diffs into
 * a REVOKE.
 * Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { exportSqlFiles, type ExportOptions } from "./export-sql-files.ts";

function exportOf(facts: Fact[], options?: ExportOptions): string {
  return exportSqlFiles(buildFactBase(facts, []), options)
    .map((f) => f.sql)
    .join("\n");
}

describe("export preserves public-schema customizations", () => {
  test("a non-default COMMENT ON SCHEMA public is exported", () => {
    const sql = exportOf([
      { id: { kind: "schema", name: "public" }, payload: {} },
      {
        id: { kind: "comment", target: { kind: "schema", name: "public" } },
        parent: { kind: "schema", name: "public" },
        payload: { text: "custom note" },
      },
    ]);
    expect(sql).toContain("custom note");
    // the schema itself still must NOT be recreated (it always exists).
    expect(sql).not.toContain("CREATE SCHEMA");
    expect(sql).not.toContain("REVOKE");
  });

  test("a customized public ACL (no CREATE for PUBLIC) is exported", () => {
    const sql = exportOf([
      { id: { kind: "schema", name: "public" }, payload: {} },
      {
        id: {
          kind: "acl",
          target: { kind: "schema", name: "public" },
          grantee: "PUBLIC",
        },
        parent: { kind: "schema", name: "public" },
        // PUBLIC keeps only USAGE — CREATE has been revoked.
        payload: { privileges: ["USAGE"], grantable: [] },
      },
    ]);
    expect(sql).toContain(`SCHEMA "public"`);
    expect(sql).toContain("REVOKE ALL ON SCHEMA");
  });

  test("a revoked default public grant is exported as a REVOKE", () => {
    const sql = exportOf(
      [
        { id: { kind: "schema", name: "public" }, payload: {} },
        {
          id: {
            kind: "acl",
            target: { kind: "schema", name: "public" },
            grantee: "authenticated",
          },
          parent: { kind: "schema", name: "public" },
          payload: { privileges: ["USAGE"], grantable: [] },
        },
      ],
      {
        assumedRoles: ["anon", "authenticated", "postgres"],
        assumedDefaultGrants: ["anon", "authenticated"].map((grantee) => ({
          creatingRole: "postgres",
          schema: "public",
          objtype: "r",
          grantee,
        })),
      },
    );
    /* every fresh public grants PUBLIC; the overlay adds anon */
    expect(sql).toContain(`REVOKE ALL ON SCHEMA "public" FROM PUBLIC`);
    expect(sql).toContain(`REVOKE ALL ON SCHEMA "public" FROM "anon"`);
    /* a grant live still holds exports as before */
    expect(sql).toContain(`GRANT USAGE ON SCHEMA "public" TO "authenticated"`);
  });
});
