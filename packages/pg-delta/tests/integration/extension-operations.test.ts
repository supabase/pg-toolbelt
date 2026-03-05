import { describe, test } from "bun:test";
import dedent from "dedent";
import type { Change } from "../../src/core/change.types.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbSupabaseIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`extension operations (pg${pgVersion})`, () => {
    test(
      "create extension",
      withDbSupabaseIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `
          CREATE EXTENSION vector WITH SCHEMA extensions;
          CREATE TABLE test_table (vec extensions.vector);
        `,
          sortChangesCallback: (a, b) => {
            const priority = (change: Change) => {
              if (
                change.objectType === "extension" &&
                change.operation === "create" &&
                change.scope === "object"
              ) {
                return 0;
              }
              if (
                change.objectType === "table" &&
                change.operation === "create"
              ) {
                return 1;
              }
              if (
                change.objectType === "extension" &&
                change.operation === "create" &&
                change.scope === "comment"
              ) {
                return 2;
              }
              return 3;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );

    test(
      "extension with comment",
      withDbSupabaseIsolated(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA IF NOT EXISTS extensions;",
          testSql: dedent`
            CREATE EXTENSION vector WITH SCHEMA extensions;
            COMMENT ON EXTENSION vector IS 'Vector similarity search';
          `,
          sortChangesCallback: (a, b) => {
            const priority = (change: Change) => {
              if (
                change.objectType === "extension" &&
                change.operation === "create" &&
                change.scope === "object"
              ) {
                return 0;
              }
              if (
                change.objectType === "extension" &&
                change.operation === "create" &&
                change.scope === "comment"
              ) {
                return 1;
              }
              return 2;
            };
            return priority(a) - priority(b);
          },
        });
      }),
    );
  });
}
