/**
 * Integration test: declarative export/apply roundtrip with overloaded functions.
 *
 * Reproduces the bug where ALTER FUNCTION ... OWNER TO is emitted without
 * an argument list, causing PostgreSQL error 42725 ("function name is not unique")
 * when multiple overloads of the same function exist.
 *
 * Flow: create two overloaded functions in branch -> export declarative schema
 * -> apply to main -> verify 0 remaining diff.
 */

import { describe, expect, test } from "bun:test";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { applyDeclarativeSchema } from "../../src/core/declarative-apply/index.ts";
import { exportDeclarativeSchema } from "../../src/core/export/index.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";
import { POSTGRES_VERSIONS, type PostgresVersion } from "../constants.ts";
import { withDb } from "../utils.ts";

const OVERLOADED_FUNCTIONS_SQL = `
-- Two overloads of the same function name (like publish_package in dbdev)
create function public.overload_me(a integer, b text)
returns void language plpgsql as $$ begin end; $$;

create function public.overload_me(x bigint)
returns void language plpgsql as $$ begin end; $$;
`;

for (const pgVersion of POSTGRES_VERSIONS as PostgresVersion[]) {
  describe(`overloaded functions roundtrip (pg${pgVersion})`, () => {
    test(
      "exported schema with overloaded functions applies and roundtrips to 0 changes",
      withDb(pgVersion, async ({ main, branch }) => {
        // Branch: add two overloaded functions. Main stays clean.
        await branch.query(OVERLOADED_FUNCTIONS_SQL);

        const planResult = await createPlan(main, branch);
        if (!planResult) {
          throw new Error(
            "createPlan returned null -- expected changes (two new functions)",
          );
        }

        const output = exportDeclarativeSchema(planResult);

        const applyResult = await applyDeclarativeSchema({
          content: output.files.map((f) => ({ filePath: f.path, sql: f.sql })),
          pool: main,
          disableCheckFunctionBodies: true,
          validateFunctionBodies: false,
        });

        if (applyResult.apply.status !== "success") {
          const stuckSql = applyResult.apply.stuckStatements
            ?.map((s) => `[${s.code}] ${s.message}\n  SQL: ${s.statement.sql}`)
            .join("\n");
          const errorSql = applyResult.apply.errors
            ?.map((s) => `[${s.code}] ${s.message}\n  SQL: ${s.statement.sql}`)
            .join("\n");
          throw new Error(
            `Declarative apply failed (${applyResult.apply.status}):\n${stuckSql ?? errorSql ?? "(no detail)"}`,
            { cause: applyResult },
          );
        }

        const mainCatalog = await extractCatalog(main);
        const branchCatalog = await extractCatalog(branch);
        const remainingChanges = diffCatalogs(mainCatalog, branchCatalog);

        if (remainingChanges.length > 0) {
          const sorted = sortChanges(
            { mainCatalog, branchCatalog },
            remainingChanges,
          );
          const remainingSql = sorted.map((c) => c.serialize()).join(";\n");
          console.error(
            `[overloaded-functions-roundtrip] ${remainingChanges.length} remaining change(s):\n${remainingSql}`,
          );
        }

        expect(remainingChanges).toHaveLength(0);
      }),
      60 * 1000,
    );
  });
}
