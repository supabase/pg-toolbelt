import { describe, expect, test } from "bun:test";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { applyDeclarativeSchema } from "../../src/core/declarative-apply/index.ts";
import { exportDeclarativeSchema } from "../../src/core/export/index.ts";
import { compileFilterDSL } from "../../src/core/integrations/filter/dsl.ts";
import { compileSerializeDSL } from "../../src/core/integrations/serialize/dsl.ts";
import { supabase as supabaseIntegration } from "../../src/core/integrations/supabase.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";
import { SUPABASE_POSTGRES_VERSIONS } from "../constants.ts";
import { withDbSupabaseIsolated } from "../utils.ts";

// Only extensions whose control file pins a non-default target schema can
// trip the issue #222 bug: `CREATE EXTENSION foo WITH SCHEMA <s>` fails when
// <s> does not exist on main. Relocatable / `public`-default extensions
// always resolve against public, which always exists, and extensions pinned
// to `pg_catalog` (plpgsql) use a built-in schema that also always exists.
// Installing only the pinned-schema subset keeps the test CI-friendly while
// still exercising every code path the fix touches.
const PINNED_SCHEMA_EXTENSION_QUERY = `
  SELECT v.name
  FROM pg_available_extension_versions v
  JOIN pg_available_extensions a ON a.name = v.name
  WHERE v.version = a.default_version
    AND v.schema IS NOT NULL
    AND v.schema NOT IN ('public', 'pg_catalog')
  ORDER BY v.name
`;

for (const pgVersion of SUPABASE_POSTGRES_VERSIONS) {
  describe(`supabase extension declarative roundtrip (pg${pgVersion})`, () => {
    test(
      "every pinned-schema extension reapplies cleanly via the supabase integration",
      withDbSupabaseIsolated(pgVersion, async (db) => {
        const available = await db.branch.query<{ name: string }>(
          PINNED_SCHEMA_EXTENSION_QUERY,
        );

        for (const row of available.rows) {
          await db.branch.query(
            `CREATE EXTENSION IF NOT EXISTS "${row.name}" CASCADE`,
          );
        }

        // Drop every extension pre-installed on main (by the supabase/postgres
        // image itself or by the base-init fixture) whose target schema is
        // non-public and pinned, so the roundtrip has to emit CREATE EXTENSION
        // against an empty target. Without this, image-installed extensions
        // like pg_graphql (graphql) / supabase_vault (vault) never exercise
        // the WITH SCHEMA code path where the issue #222 bug lives.
        const pinned = new Set(available.rows.map((row) => row.name));
        const preInstalled = await db.main.query<{ name: string }>(
          `SELECT extname AS name FROM pg_extension`,
        );
        for (const row of preInstalled.rows) {
          if (pinned.has(row.name)) {
            await db.main.query(
              `DROP EXTENSION IF EXISTS "${row.name}" CASCADE`,
            );
          }
        }

        if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
          throw new Error("supabase integration missing filter or serialize");
        }

        const compiledFilter = compileFilterDSL(supabaseIntegration.filter);
        const compiledSerialize = compileSerializeDSL(
          supabaseIntegration.serialize,
        );

        const planResult = await createPlan(db.main, db.branch, {
          filter: supabaseIntegration.filter,
          serialize: supabaseIntegration.serialize,
          skipDefaultPrivilegeSubtraction: true,
        });

        if (!planResult) {
          throw new Error(
            "createPlan returned null -- no changes detected between baseline and branch",
          );
        }

        const output = exportDeclarativeSchema(planResult, {
          integration: { serialize: compiledSerialize },
        });

        const applyResult = await applyDeclarativeSchema({
          content: output.files.map((file) => ({
            filePath: file.path,
            sql: file.sql,
          })),
          pool: db.main,
          disableCheckFunctionBodies: true,
          validateFunctionBodies: false,
        });

        if (applyResult.apply.status !== "success") {
          console.error(
            `[supabase-extension-roundtrip pg${pgVersion}] declarative apply ${applyResult.apply.status}:\n` +
              JSON.stringify(applyResult.apply, null, 2),
          );
          throw new Error(
            `Declarative apply failed (${applyResult.apply.status})`,
            { cause: applyResult },
          );
        }

        const mainCatalog = await extractCatalog(db.main);
        const branchCatalog = await extractCatalog(db.branch);
        const allChanges = diffCatalogs(mainCatalog, branchCatalog);
        const remainingChanges = allChanges.filter(compiledFilter);

        if (remainingChanges.length > 0) {
          const sorted = sortChanges(
            { mainCatalog, branchCatalog },
            remainingChanges,
          );
          const remainingSql = sorted
            .map((change) => change.serialize())
            .join(";\n");
          console.error(
            `[supabase-extension-roundtrip pg${pgVersion}] ${remainingChanges.length} remaining change(s) after roundtrip:\n${remainingSql}`,
          );
        }

        expect(remainingChanges).toHaveLength(0);
      }),
      5 * 60 * 1000,
    );
  });
}
