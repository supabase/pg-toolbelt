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

// Extensions that are either pre-installed (plpgsql) or not a real
// CREATE EXTENSION candidate in a running database (wal2json is a logical
// decoding output plugin that only ships the .so — pg_available_extensions
// exposes it but CREATE EXTENSION fails on it).
const SKIP_INSTALL = new Set(["plpgsql", "wal2json"]);

for (const pgVersion of SUPABASE_POSTGRES_VERSIONS) {
  describe(`supabase all-extensions declarative roundtrip (pg${pgVersion})`, () => {
    test(
      "every available extension reapplies cleanly via the supabase integration",
      withDbSupabaseIsolated(pgVersion, async (db) => {
        const available = await db.branch.query<{ name: string }>(
          `SELECT name
           FROM pg_available_extensions
           ORDER BY name`,
        );

        const extensionsToInstall = available.rows
          .map((row) => row.name)
          .filter((name) => !SKIP_INSTALL.has(name));

        for (const name of extensionsToInstall) {
          await db.branch.query(
            `CREATE EXTENSION IF NOT EXISTS "${name}" CASCADE`,
          );
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
            `[supabase-all-extensions-roundtrip pg${pgVersion}] declarative apply ${applyResult.apply.status}:\n` +
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
            `[supabase-all-extensions-roundtrip pg${pgVersion}] ${remainingChanges.length} remaining change(s) after roundtrip:\n${remainingSql}`,
          );
        }

        expect(remainingChanges).toHaveLength(0);
      }),
      5 * 60 * 1000,
    );
  });
}
