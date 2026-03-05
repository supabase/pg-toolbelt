/**
 * Integration tests for collation create, alter, drop, and comment.
 */

import { describe, test } from "bun:test";
import dedent from "dedent";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`collation operations (pg${pgVersion})`, () => {
    test(
      "create collation",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA coll_schema;",
          testSql: dedent`
            CREATE COLLATION coll_schema.c1 (LC_COLLATE = 'C', LC_CTYPE = 'C');
          `,
        });
      }),
    );

    test(
      "comment on collation",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA coll_schema;
            CREATE COLLATION coll_schema.c2 (LC_COLLATE = 'C', LC_CTYPE = 'C');
          `,
          testSql: dedent`
            COMMENT ON COLLATION coll_schema.c2 IS 'Test collation comment';
          `,
        });
      }),
    );
  });
}
