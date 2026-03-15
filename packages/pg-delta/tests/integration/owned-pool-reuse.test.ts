import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { applyPlan, createPlan } from "../promise-helpers.ts";
import { withDb } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`owned pool reuse (pg${pgVersion})`, () => {
    test(
      "reuses owned pool adapters across repeated effect operations",
      withDb(pgVersion, async (db) => {
        for (let iteration = 0; iteration < 5; iteration += 1) {
          const schema = `reuse_${iteration}`;

          await db.branch.query(`CREATE SCHEMA ${schema}`);

          await Effect.runPromise(extractCatalog(db.mainDb));
          await Effect.runPromise(extractCatalog(db.branchDb));

          const planResult = await createPlan(db.mainDb, db.branchDb);
          expect(planResult).not.toBeNull();
          if (!planResult) {
            continue;
          }

          const applyResult = await applyPlan(
            planResult.plan,
            db.mainDb,
            db.branchDb,
            {
              verifyPostApply: true,
            },
          );

          expect(applyResult.status).toBe("applied");

          const schemaExists = await db.main.query(
            "select 1 from pg_namespace where nspname = $1",
            [schema],
          );
          expect(schemaExists.rowCount).toBe(1);
        }
      }),
    );
  });
}
