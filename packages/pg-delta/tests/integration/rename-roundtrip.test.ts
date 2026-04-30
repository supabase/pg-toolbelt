/**
 * Integration tests reproducing the rename scenarios from
 * https://github.com/supabase/pg-toolbelt/issues/228.
 *
 * pg-delta is a state-based diff: a `RENAME` and a `DROP+CREATE` produce
 * identical final catalogs and pg-delta cannot tell them apart. The drop+
 * create path must therefore still produce SQL that converges the source
 * with the target. These tests pin that behavior end-to-end so the planner
 * does not silently regress on dependent objects (sequences owned by the
 * dropped column, views referencing the dropped table/column).
 */

import { describe, test } from "bun:test";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`rename roundtrip (pg${pgVersion})`, () => {
    test(
      "table rename with SERIAL column converges",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
            CREATE TABLE public.old_table (
              id serial PRIMARY KEY,
              name text
            );
          `,
          testSql: "ALTER TABLE public.old_table RENAME TO new_table;",
        });
      }),
    );

    test(
      "column rename with dependent view converges",
      withDb(pgVersion, async (db) => {
        // CREATE OR REPLACE VIEW cannot rename existing view columns, so the
        // realistic target shape (column "full_name" feeding a view column
        // also named "full_name") requires drop + create on the view.
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
            CREATE TABLE public.users (id int PRIMARY KEY, name text);
            CREATE VIEW public.user_list AS SELECT name FROM public.users;
          `,
          testSql: `
            DROP VIEW public.user_list;
            ALTER TABLE public.users RENAME COLUMN name TO full_name;
            CREATE VIEW public.user_list AS SELECT full_name FROM public.users;
          `,
        });
      }),
    );

    test(
      "table rename with dependent view converges",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
            CREATE TABLE public.users (id int PRIMARY KEY, name text);
            CREATE VIEW public.user_count AS SELECT COUNT(*) AS n FROM public.users;
          `,
          testSql: "ALTER TABLE public.users RENAME TO members;",
        });
      }),
    );
  });
}
