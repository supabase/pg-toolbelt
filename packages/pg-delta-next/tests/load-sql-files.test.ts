/** Stage-7 shadow loader: ordering convergence + the rejection behaviors. */
import { describe, expect, test } from "bun:test";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import { extract } from "../src/extract/extract.ts";
import { createTestDb } from "./containers.ts";

describe("loadSqlFiles (shadow frontend)", () => {
  test("out-of-order files converge via bounded rounds", async () => {
    const shadow = await createTestDb("shadow");
    try {
      // lexicographic order is wrong on purpose: the view file sorts first
      const result = await loadSqlFiles(
        [
          {
            name: "01_view.sql",
            sql: "CREATE VIEW public.v AS SELECT id FROM public.t;",
          },
          {
            name: "02_table.sql",
            sql: "CREATE TABLE public.t (id integer PRIMARY KEY);",
          },
        ],
        shadow.pool,
      );
      expect(result.rounds).toBeGreaterThan(1);
      expect(
        result.factBase.has({ kind: "view", schema: "public", name: "v" }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("unorderable input fails loudly with stuck statements, before extraction", async () => {
    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "broken.sql",
              sql: "CREATE VIEW public.v AS SELECT * FROM public.ghost;",
            },
          ],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/stuck/);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("DML is rejected by observation, not parsing", async () => {
    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "schema.sql",
              sql: "CREATE TABLE public.t (id integer); INSERT INTO public.t VALUES (1);",
            },
          ],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/data statements/);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("role-creating files are rejected in database-scratch mode", async () => {
    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(
        loadSqlFiles(
          [{ name: "roles.sql", sql: "CREATE ROLE shadow_leak_test NOLOGIN;" }],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/cluster-level/);
    } finally {
      await shadow.pool
        .query("DROP ROLE IF EXISTS shadow_leak_test")
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  test("typo'd function body is caught by re-validation", async () => {
    const shadow = await createTestDb("shadow");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "fn.sql",
              sql: `CREATE FUNCTION public.broken() RETURNS integer LANGUAGE sql AS 'SELECT id FROM public.missing_table';`,
            },
          ],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("declarative end-to-end: files -> shadow -> plan -> prove against a live target", async () => {
    const shadow = await createTestDb("shadow");
    const target = await createTestDb("target");
    try {
      await target.pool.query("CREATE TABLE public.old_stuff (id integer)");
      const loaded = await loadSqlFiles(
        [
          {
            name: "schema.sql",
            sql: `CREATE TABLE public.users (id integer PRIMARY KEY, email text NOT NULL);
                  CREATE INDEX users_email_idx ON public.users (email);`,
          },
        ],
        shadow.pool,
      );
      const current = await extract(target.pool);
      const thePlan = plan(current.factBase, loaded.factBase);
      const clone = await target.clone();
      try {
        const verdict = await provePlan(thePlan, clone.pool, loaded.factBase);
        expect(verdict.applyError).toBeUndefined();
        expect(verdict.driftDeltas).toEqual([]);
        expect(verdict.ok).toBe(true);
      } finally {
        await clone.drop();
      }
    } finally {
      await Promise.all([shadow.drop(), target.drop()]);
    }
  }, 120_000);
});
