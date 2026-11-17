/**
 * Regression coverage: a USER routine whose body fails the post-load
 * `check_function_bodies = on` re-validation must NOT be a fatal load error by
 * default. Postgres itself accepts the function under `check_function_bodies =
 * off` (which pg-delta's own apply executor emits in every plan preamble,
 * `src/plan/plan.ts`), so refusing to READ back a function pg-delta would
 * happily WRITE is an asymmetry that blocks round-tripping any real schema that
 * relies on check-off (legacy forward refs, tolerated casts, …).
 *
 * The loader now classifies a phase-2 body-validation failure three ways:
 *   1. seeded/reference-only routine, unchanged → WARNING, distinct code
 *      `invalid_seeded_routine_body` (covered in load-seeded-schema-validation).
 *   2. routine in a seeded schema but NOT an unchanged seed → FATAL, code
 *      `invalid_routine_body` (Codex #329 hardening — covered there too).
 *   3. USER routine (schema not seeded) → WARNING by default (code
 *      `invalid_routine_body`), FATAL only under `strictFunctionBodies: true`.
 *
 * This file covers class 3 (the mission) and the strict opt-in, plus an
 * end-to-end export → apply round-trip against a fresh database with default
 * (lenient) settings.
 *
 * Stock alpine image; Docker required.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import { queryText } from "./apply-test-helpers.ts";
import { createTestDb, sharedCluster } from "./containers.ts";

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

// A user-schema function that loads fine under check-off but fails strict
// re-validation (references a table that does not exist). `public` is NOT a
// seeded schema, so this is class 3.
const LEGACY_FN_SQL =
  "CREATE FUNCTION public.legacy() RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent';";

// Enough valid user routines to span several re-validation round trips.
const MANY_FNS_SQL = Array.from(
  { length: 450 },
  (_, i) =>
    `CREATE FUNCTION public.f${i}() RETURNS int LANGUAGE sql AS 'SELECT ${i}';`,
).join("\n");

// LEGACY_FN_SQL first, then the valid routines, then a second broken routine
// created last, so the two failures land in the first and a later round trip.
const BROKEN_FIRST_AND_LAST_SQL = `${LEGACY_FN_SQL}
${MANY_FNS_SQL}
CREATE FUNCTION public.zz_legacy() RETURNS int LANGUAGE sql AS 'SELECT y FROM nonexistent';`;

/** Record the SQL of every query sent on each client `pool` opens from now on. */
function recordQueries(pool: pg.Pool): string[] {
  const queries: string[] = [];
  pool.on("connect", (client) => {
    const query = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as { query: unknown }).query = (...args: unknown[]) => {
      queries.push(queryText(args[0]));
      return query(...args);
    };
  });
  return queries;
}

describe("loadSqlFiles — lenient user-routine body validation", () => {
  test("a user routine that fails strict re-lint loads with a WARNING by default", async () => {
    const shadow = await createTestDb("lenientdefault");
    try {
      const result = await loadSqlFiles(
        [{ name: "01_fn.sql", sql: LEGACY_FN_SQL }],
        shadow.pool,
      );

      const warning = result.diagnostics.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(warning).toBeDefined();
      expect(warning?.severity).toBe("warning");
      expect(warning?.message).toContain("public.legacy:");
      expect(warning?.message).toContain("nonexistent");

      // the function is present in the loaded fact base (it was created).
      expect(
        result.factBase.has({
          kind: "function",
          schema: "public",
          name: "legacy",
          args: [],
        }),
      ).toBe(true);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("strictFunctionBodies: true restores the fatal gate for a user routine", async () => {
    const shadow = await createTestDb("lenientstrict");
    try {
      const err = await captureError(
        loadSqlFiles([{ name: "01_fn.sql", sql: LEGACY_FN_SQL }], shadow.pool, {
          strictFunctionBodies: true,
        }),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      const detail = (err as ShadowLoadError).details.find(
        (d) => d.code === "invalid_routine_body",
      );
      expect(detail).toBeDefined();
      expect(detail?.severity).toBe("error");
      expect(detail?.message).toContain("public.legacy:");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("re-validation sends many routine definitions in a few round trips", async () => {
    const shadow = await createTestDb("revalbatch");
    const queries = recordQueries(shadow.pool);
    try {
      await loadSqlFiles(
        [{ name: "01_fns.sql", sql: MANY_FNS_SQL }],
        shadow.pool,
      );
      const checksOn = queries.indexOf("SET check_function_bodies = on");
      expect(checksOn).toBeGreaterThan(-1);
      const revalidation = queries
        .slice(checksOn)
        .filter((q) => q.startsWith("CREATE OR REPLACE"));
      // 450 routines: a handful of chunked round trips, not one per routine.
      expect(revalidation.length).toBeGreaterThan(0);
      expect(revalidation.length).toBeLessThan(10);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("a routine the loading role cannot replace costs no extra round trips", async () => {
    const shadow = await createTestDb("revalunowned");
    const owner = `reval_owner_${shadow.name}`;
    const loader = `reval_loader_${shadow.name}`;
    // Like a Supabase shadow's platform routines: created before the load and
    // owned by a role the (non-superuser) loading role is not a member of.
    await shadow.pool.query(
      `CREATE ROLE "${owner}";
       CREATE ROLE "${loader}" LOGIN PASSWORD 'loader' NOSUPERUSER;
       GRANT ALL ON DATABASE "${shadow.name}" TO "${loader}";
       GRANT ALL ON SCHEMA public TO "${loader}";
       CREATE FUNCTION public.platform_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
       ALTER FUNCTION public.platform_fn() OWNER TO "${owner}";`,
    );
    const loaderPool = new pg.Pool({
      connectionString: shadow.uri.replace(
        "postgres://test:test@",
        `postgres://${loader}:loader@`,
      ),
      max: 2,
    });
    loaderPool.on("error", () => {});
    const queries = recordQueries(loaderPool);
    try {
      const result = await loadSqlFiles(
        [{ name: "01_fns.sql", sql: MANY_FNS_SQL }],
        loaderPool,
      );
      expect(
        result.diagnostics.filter((d) => d.code === "invalid_routine_body"),
      ).toMatchInlineSnapshot(`
        [
          {
            "code": "invalid_routine_body",
            "message": "public.platform_fn: must be owner of function platform_fn",
            "severity": "warning",
          },
        ]
      `);
      const checksOn = queries.indexOf("SET check_function_bodies = on");
      expect(checksOn).toBeGreaterThan(-1);
      const revalidation = queries
        .slice(checksOn)
        .filter((q) => q.startsWith("CREATE OR REPLACE"));
      expect(revalidation.length).toBeGreaterThan(0);
      expect(revalidation.length).toBeLessThan(10);
    } finally {
      await loaderPool.end();
      await shadow.drop();
      await shadow.cluster.adminPool.query(
        `DROP ROLE IF EXISTS "${loader}"; DROP ROLE IF EXISTS "${owner}";`,
      );
    }
  }, 60_000);

  test("strict: broken routines in the first and a later round trip are each attributed", async () => {
    const shadow = await createTestDb("revalstrictlate");
    try {
      const err = await captureError(
        loadSqlFiles(
          [{ name: "01_fns.sql", sql: BROKEN_FIRST_AND_LAST_SQL }],
          shadow.pool,
          { strictFunctionBodies: true },
        ),
      );
      expect(err).toBeInstanceOf(ShadowLoadError);
      expect((err as ShadowLoadError).message).toMatchInlineSnapshot(
        `"2 routine bodies failed validation"`,
      );
      expect((err as ShadowLoadError).details).toMatchInlineSnapshot(`
        [
          {
            "code": "invalid_routine_body",
            "message": "public.legacy: relation "nonexistent" does not exist",
            "severity": "error",
          },
          {
            "code": "invalid_routine_body",
            "message": "public.zz_legacy: relation "nonexistent" does not exist",
            "severity": "error",
          },
        ]
      `);
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  test("export → load round-trip of a check-off function succeeds with default (lenient) settings and preserves the def", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("lenient_rt_src");
    const shadow = await cluster.createDb("lenient_rt_shadow");
    try {
      // Author a function on the SOURCE the way Postgres allows it: with
      // check_function_bodies OFF, so a body that fails strict re-validation is
      // accepted. Extraction just reads catalogs, so the source captures fine.
      await src.pool.query(
        `SET check_function_bodies = off;
         CREATE FUNCTION public.legacy() RETURNS int LANGUAGE sql AS 'SELECT x FROM nonexistent';`,
      );
      const srcExtract = await extract(src.pool);
      const fb = srcExtract.factBase;
      const srcDef = (
        await src.pool.query(
          `SELECT pg_get_functiondef('public.legacy()'::regprocedure) AS def`,
        )
      ).rows[0] as { def: string };

      // export → apply against a FRESH database with DEFAULT (lenient) settings.
      const files = exportSqlFiles(fb, { layout: "by-object" }).filter(
        (f) => !/cluster[_/]roles/.test(f.name),
      );
      const loaded = await loadSqlFiles(files, shadow.pool);

      // fidelity: the loaded fact base hash-matches the source, AND the target's
      // re-extracted function definition is byte-identical.
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
      const targetDef = (
        await shadow.pool.query(
          `SELECT pg_get_functiondef('public.legacy()'::regprocedure) AS def`,
        )
      ).rows[0] as { def: string };
      expect(targetDef.def).toBe(srcDef.def);
    } finally {
      await Promise.all([src.drop(), shadow.drop()]);
    }
  }, 120_000);
});
