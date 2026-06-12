/**
 * Integration tests for the wildcard-based filter DSL.
 *
 * Validates that path-based patterns correctly filter changes
 * against real PostgreSQL databases.
 */

import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/index.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { flattenPlanStatements } from "../../src/core/plan/render.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`wildcard-based filter DSL (pg${pgVersion})`, () => {
    test(
      "*/schema filters by schema across object types",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE SCHEMA app");
        await db.branch.query("CREATE TABLE public.pub_t (id integer)");
        await db.branch.query("CREATE TABLE app.app_t (id integer)");
        await db.branch.query(
          "CREATE VIEW app.app_v AS SELECT id FROM app.app_t",
        );

        const resultWithoutFilter = await createPlan(db.main, db.branch);
        const stmts = resultWithoutFilter
          ? flattenPlanStatements(resultWithoutFilter.plan)
          : [];
        expect(stmts).toHaveLength(4);
        expect(stmts[0]).toBe("CREATE SCHEMA app AUTHORIZATION postgres");
        expect(stmts[1]).toBe("CREATE TABLE app.app_t (id integer)");
        // View SQL varies across PG versions: PG15 qualifies columns (app_t.id)
        // while PG17 does not (id), so we use a regex instead of an inline snapshot.
        expect(stmts[2]).toMatch(
          /CREATE VIEW app\.app_v AS SELECT (app_t\.)?id\s+FROM app\.app_t/,
        );
        expect(stmts[3]).toBe("CREATE TABLE public.pub_t (id integer)");

        const result = await createPlan(db.main, db.branch, {
          filter: { "*/schema": "app" },
        });

        expect(result).not.toBeNull();
        const filtered = result ? flattenPlanStatements(result.plan) : [];
        expect(filtered).toHaveLength(3);
        expect(filtered[0]).toBe("CREATE SCHEMA app AUTHORIZATION postgres");
        expect(filtered[1]).toBe("CREATE TABLE app.app_t (id integer)");
        // See comment above — view SQL varies across PG versions.
        expect(filtered[2]).toMatch(
          /CREATE VIEW app\.app_v AS SELECT (app_t\.)?id\s+FROM app\.app_t/,
        );
      }),
    );

    test(
      "objectType filters by change type",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE TABLE public.t1 (id integer)");
        await db.branch.query(
          "CREATE VIEW public.v1 AS SELECT id FROM public.t1",
        );

        const result = await createPlan(db.main, db.branch, {
          filter: { objectType: "table" },
        });

        expect(result).not.toBeNull();
        expect(flattenPlanStatements(result!.plan)).toMatchInlineSnapshot(`
          [
            "CREATE TABLE public.t1 (id integer)",
          ]
        `);
      }),
    );

    test(
      "not with */schema excludes schema",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE SCHEMA excluded");
        await db.branch.query("CREATE TABLE excluded.secret (id integer)");
        await db.branch.query("CREATE TABLE public.visible (id integer)");

        const result = await createPlan(db.main, db.branch, {
          filter: {
            not: {
              or: [{ "*/schema": "excluded" }],
            },
          },
        });

        expect(result).not.toBeNull();
        expect(flattenPlanStatements(result!.plan)).toMatchInlineSnapshot(`
          [
            "CREATE TABLE public.visible (id integer)",
          ]
        `);
      }),
    );

    test(
      "boolean matching on table/is_partition",
      withDb(pgVersion, async (db) => {
        await db.branch.query(
          "CREATE TABLE public.parent (id integer) PARTITION BY RANGE (id)",
        );
        await db.branch.query(
          "CREATE TABLE public.child PARTITION OF public.parent FOR VALUES FROM (0) TO (100)",
        );
        await db.branch.query("CREATE TABLE public.regular (id integer)");

        const result = await createPlan(db.main, db.branch, {
          filter: {
            objectType: "table",
            scope: "object",
            operation: "create",
            "table/is_partition": false,
          },
        });

        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const tableNames = result.sortedChanges
          .filter((c) => c.objectType === "table" && c.scope === "object")
          .map((c) => {
            if (c.objectType === "table") return c.table.name;
            return "";
          });
        expect(tableNames).toContain("parent");
        expect(tableNames).toContain("regular");
        expect(tableNames).not.toContain("child");
      }),
    );

    test(
      "regex matching on requires",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE SCHEMA myschema");
        await db.branch.query("CREATE TABLE myschema.t1 (id integer)");

        const result = await createPlan(db.main, db.branch, {
          filter: {
            requires: { op: "regex", value: "^schema:myschema$" },
          },
        });

        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        // Only changes that require myschema should be included
        for (const change of result.sortedChanges) {
          expect(
            change.requires.some((r: string) => /^schema:myschema$/.test(r)),
          ).toBe(true);
        }
      }),
    );

    test(
      "--filter AND-combines with integration filter",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE TABLE public.t1 (id integer)");
        await db.branch.query(
          "CREATE VIEW public.v1 AS SELECT id FROM public.t1",
        );

        // Integration filter: only public schema
        // Additional filter: only tables
        const result = await createPlan(db.main, db.branch, {
          filter: {
            and: [{ "*/schema": "public" }, { objectType: "table" }],
          },
        });

        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const types = result.sortedChanges.map((c) => c.objectType);
        expect(types.every((t) => t === "table")).toBe(true);
      }),
    );
  });
}
