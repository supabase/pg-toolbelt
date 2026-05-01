/**
 * Integration test: minimal reproduction of the "CREATE OR REPLACE TRIGGER"
 * infinite diff loop.
 *
 * Bug summary:
 *   `Trigger.column_numbers` stores the raw `pg_trigger.tgattr` int2vector,
 *   i.e. the physical `attnum` of each column referenced by `CREATE TRIGGER
 *   ... UPDATE OF col_a, col_b, ...`. When the same trigger is created on
 *   logically-identical tables whose physical column layout differs (because
 *   one was built with `CREATE TABLE ... (everything)` and the other grew via
 *   `CREATE TABLE + ALTER TABLE DROP/ADD COLUMN`), the `tgattr` vectors
 *   disagree even though the column NAMES in the trigger definition match.
 *
 *   `pg_get_triggerdef()` renders column names (not attnums), so the
 *   emitted `CREATE OR REPLACE TRIGGER ...` SQL is functionally correct and
 *   identical on both sides. However, the catalog diff compares `tgattr`
 *   through `deepEqual` in `NON_ALTERABLE_FIELDS` and always flags the
 *   trigger as needing a `ReplaceTrigger`. Because `CREATE OR REPLACE
 *   TRIGGER` does not renumber the underlying table's columns, re-applying
 *   the emitted SQL never converges -- every subsequent sync reports the
 *   same phantom change.
 *
 * This test reproduces the behavior with the smallest possible setup so the
 * regression signal is easy to interpret.
 */

import { describe, expect, test } from "bun:test";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { ReplaceTrigger } from "../../src/core/objects/trigger/changes/trigger.alter.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDbIsolated } from "../utils.ts";

const TRIGGER_FUNCTION_SQL = `
  CREATE FUNCTION public.trg_fn() RETURNS trigger
    LANGUAGE plpgsql AS $$
  BEGIN
    RETURN NEW;
  END;
  $$;
`;

const TRIGGER_SQL = `
  CREATE TRIGGER trg
    BEFORE UPDATE OF a, b, d
    ON public.t
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_fn();
`;

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`trigger UPDATE OF column-number diff loop (pg${pgVersion})`, () => {
    test(
      "same-named columns on tables with different physical attnums must not produce a trigger diff",
      withDbIsolated(pgVersion, async (db) => {
        // main: built with a single CREATE TABLE -- columns a, b, d get
        // consecutive attnums 1, 2, 3.
        await db.main.query(`
          CREATE TABLE public.t (
            a int,
            b int,
            d int
          );
        `);
        await db.main.query(TRIGGER_FUNCTION_SQL);
        await db.main.query(TRIGGER_SQL);

        // branch: same logical columns, but grown via ALTER TABLE so that the
        // physical attnums of a, b, d differ from main (in particular, b was
        // dropped and re-added, and d was added after c was dropped -- so
        // tgattr on branch will contain sparse, larger attnums).
        await db.branch.query(`
          CREATE TABLE public.t (
            a int,
            b int,
            c int
          );
          ALTER TABLE public.t DROP COLUMN b;
          ALTER TABLE public.t DROP COLUMN c;
          ALTER TABLE public.t ADD COLUMN b int;
          ALTER TABLE public.t ADD COLUMN d int;
        `);
        await db.branch.query(TRIGGER_FUNCTION_SQL);
        await db.branch.query(TRIGGER_SQL);

        // Sanity check: the two trigger definitions as rendered by
        // pg_get_triggerdef() should be identical (column NAMES match). This
        // confirms the emitted SQL is semantically equivalent -- only the
        // physical attnums differ.
        const mainDef = await db.main.query<{ def: string }>(
          `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'trg' AND NOT tgisinternal`,
        );
        const branchDef = await db.branch.query<{ def: string }>(
          `SELECT pg_get_triggerdef(oid) AS def FROM pg_trigger WHERE tgname = 'trg' AND NOT tgisinternal`,
        );
        expect(mainDef.rows[0].def).toBe(branchDef.rows[0].def);

        // Extract catalogs and diff. With the current bug, the diff emits a
        // ReplaceTrigger because `column_numbers` (tgattr) differs between
        // main and branch even though the logical trigger is identical.
        const mainCatalog = await extractCatalog(db.main);
        const branchCatalog = await extractCatalog(db.branch);
        const firstChanges = diffCatalogs(mainCatalog, branchCatalog);
        const firstTriggerReplaces = firstChanges.filter(
          (c): c is ReplaceTrigger => c instanceof ReplaceTrigger,
        );

        if (firstTriggerReplaces.length > 0) {
          console.error(
            `[trigger-update-of-column-numbers] first-pass spurious ReplaceTrigger:\n${firstTriggerReplaces
              .map((c) => c.serialize())
              .join(";\n")}`,
          );
        }

        // Expected behavior: zero trigger diffs because the triggers are
        // logically identical. With the current bug this assertion fails.
        expect(firstTriggerReplaces).toHaveLength(0);

        // Second part of the bug: even if we apply the (semantically
        // identical) CREATE OR REPLACE TRIGGER SQL that the diff emits, the
        // next sync still reports the same phantom change because
        // CREATE OR REPLACE TRIGGER does not move the table's column
        // attnums. Demonstrate the non-converging loop.
        //
        // Force-run a ReplaceTrigger against main (even if the first check
        // passed we still want to confirm idempotency under the worst case)
        // to guarantee this branch is exercised independently of the fix.
        const branchTrigger = Object.values(branchCatalog.triggers)[0];
        if (!branchTrigger) {
          throw new Error(
            "expected a trigger on branch for the non-convergence check",
          );
        }
        const replace = new ReplaceTrigger({ trigger: branchTrigger });
        await db.main.query(replace.serialize());

        const mainCatalogAfter = await extractCatalog(db.main);
        const secondChanges = diffCatalogs(mainCatalogAfter, branchCatalog);
        const secondTriggerReplaces = secondChanges.filter(
          (c): c is ReplaceTrigger => c instanceof ReplaceTrigger,
        );

        if (secondTriggerReplaces.length > 0) {
          console.error(
            `[trigger-update-of-column-numbers] second-pass non-convergence:\n${secondTriggerReplaces
              .map((c) => c.serialize())
              .join(";\n")}`,
          );
        }

        expect(secondTriggerReplaces).toHaveLength(0);
      }),
    );
  });
}
