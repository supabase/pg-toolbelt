/**
 * A customization of the pre-existing `public` schema (a non-default ACL such as
 * REVOKE CREATE ON SCHEMA public FROM PUBLIC, or a changed COMMENT) must be
 * EXPORTED. The export baseline seeds only `public`'s existence — not its
 * acl/comment — so these facts diff against a pristine baseline like every other
 * schema and are emitted, instead of being masked by a same-valued baseline
 * (PR #307 review: public-schema ACL/comment preservation). Pure — no DB.
 */
import { describe, expect, test } from "bun:test";
import {
  buildFactBase,
  retainOwnerRoleDangling,
  type Fact,
} from "../core/fact.ts";
import { exportSqlFiles } from "./export-sql-files.ts";

function exportOf(facts: Fact[]): string {
  return exportSqlFiles(buildFactBase(facts, []))
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

  test("export does not serialize OWNER TO pg_database_owner on public", () => {
    const publicId = { kind: "schema" as const, name: "public" };
    const sql = exportSqlFiles(
      buildFactBase(
        [{ id: publicId, payload: {} }],
        [
          {
            from: publicId,
            to: { kind: "role", name: "pg_database_owner" },
            kind: "owner",
          },
        ],
        "liveDb",
        new Set(),
        { allowDangling: retainOwnerRoleDangling },
      ),
    )
      .map((f) => f.sql)
      .join("\n");
    expect(sql).not.toContain("OWNER TO");
    expect(sql).not.toContain("pg_database_owner");
  });
});
