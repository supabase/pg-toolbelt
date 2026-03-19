/**
 * Integration tests for the glob-based filter DSL.
 *
 * Validates that path-based patterns correctly filter changes
 * against real PostgreSQL databases.
 */

import { describe, expect, test } from "bun:test";
import { createPlan } from "../../src/core/plan/index.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`glob-based filter DSL (pg${pgVersion})`, () => {
    test(
      "*/schema filters by schema across object types",
      withDb(pgVersion, async (db) => {
        await db.branch.query("CREATE SCHEMA app");
        await db.branch.query("CREATE TABLE public.pub_t (id integer)");
        await db.branch.query("CREATE TABLE app.app_t (id integer)");
        await db.branch.query(
          "CREATE VIEW app.app_v AS SELECT id FROM app.app_t",
        );

        const result = await createPlan(db.main, db.branch, {
          filter: { "*/schema": "app" },
        });

        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const sql = result.plan.statements.join("\n");
        expect(sql).toContain("app_t");
        expect(sql).toContain("app_v");
        expect(sql).not.toContain("pub_t");
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
        if (!result) throw new Error("expected result");
        const types = result.sortedChanges.map((c) => c.objectType);
        expect(types.every((t) => t === "table")).toBe(true);
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
              or: [{ "*/schema": "excluded" }, { "schema/name": "excluded" }],
            },
          },
        });

        expect(result).not.toBeNull();
        if (!result) throw new Error("expected result");
        const sql = result.plan.statements.join("\n");
        expect(sql).toContain("visible");
        expect(sql).not.toContain("secret");
        expect(sql).not.toContain("CREATE SCHEMA");
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
