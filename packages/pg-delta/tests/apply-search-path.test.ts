/**
 * apply() runs under `search_path = pg_catalog`, the path extraction deparsed
 * under, so unqualified built-ins in the DDL bind to the same functions they
 * did in the desired state. A wider path would let an exact-type overload in a
 * user schema beat a polymorphic built-in. The cost is that a routine body
 * relying on the caller's path (basejump's generate_token → pgcrypto in
 * `extensions`) fails during apply, so that failure says how to fix it.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { apply, type ApplyReport } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb } from "./containers.ts";

async function applyUnderPath(
  base: string,
  desiredSql: string,
  searchPath: string,
  read: string,
): Promise<{ report: ApplyReport; rows: unknown[] }> {
  const target = await createTestDb("apply_sp_target");
  const desired = await createTestDb("apply_sp_desired");
  const pool = new pg.Pool({
    connectionString: target.uri,
    options: `-c search_path=${searchPath}`,
    max: 2,
  });
  pool.on("error", () => {});
  try {
    await target.pool.query(base);
    await target.pool.query("INSERT INTO public.t VALUES (1)");
    await desired.pool.query(base);
    await desired.pool.query(desiredSql);
    const p = plan(
      (await extract(target.pool)).factBase,
      (await extract(desired.pool)).factBase,
    );
    const report = await apply(p, pool);
    const { rows } = await target.pool.query(read);
    return { report, rows };
  } finally {
    await pool.end().catch(() => {});
    await target.drop();
    await desired.drop();
  }
}

describe("apply search_path", () => {
  test("an exact-type overload in the applier path does not capture a polymorphic built-in", async () => {
    const { report, rows } = await applyUnderPath(
      /* sql */ `
        CREATE SCHEMA app;
        CREATE FUNCTION app.array_append(integer[], integer) RETURNS integer[]
          LANGUAGE sql AS $$ SELECT ARRAY[99] $$;
        CREATE TABLE public.t (id integer);
      `,
      /* sql */ `
        ALTER TABLE public.t ADD COLUMN b integer[] NOT NULL
          DEFAULT pg_catalog.array_append(ARRAY[1], 2);
      `,
      "public,app",
      "SELECT b FROM public.t",
    );
    expect(report).toMatchObject({ status: "applied" });
    expect(rows).toEqual([{ b: [1, 2] }]);
  }, 120_000);

  test("a routine body relying on the caller's path fails with a search_path hint", async () => {
    const { report } = await applyUnderPath(
      /* sql */ `
        SET check_function_bodies = off;
        CREATE SCHEMA ext;
        CREATE FUNCTION ext.token_bytes() RETURNS text LANGUAGE sql
          AS $$ SELECT 'tok' $$;
        CREATE FUNCTION public.gen_token() RETURNS text LANGUAGE sql
          AS $$ SELECT token_bytes() $$;
        CREATE TABLE public.t (id integer);
      `,
      /* sql */ `
        SET search_path = public, ext;
        ALTER TABLE public.t ADD COLUMN token text NOT NULL
          DEFAULT public.gen_token();
      `,
      "public,ext",
      "SELECT 1",
    );
    expect(report.status).toBe("failed");
    expect(report.error?.message).toContain("token_bytes() does not exist");
    expect(report.error?.message).toContain("SET search_path");
  }, 120_000);
});
