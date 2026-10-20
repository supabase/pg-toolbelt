/**
 * apply() runs under `pg_catalog` followed by the applier's own search_path.
 * Expressions the DDL evaluates (an ADD COLUMN default rewrite) run routine
 * bodies whose UNqualified names must resolve like they did for the user
 * (basejump's generate_token → pgcrypto in `extensions`), while built-ins the
 * deparsed DDL leaves unqualified must never be shadowed by a user schema the
 * role lists before pg_catalog.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb, type TestDb } from "./containers.ts";

const BASE = /* sql */ `
  SET check_function_bodies = off;
  CREATE SCHEMA ext;
  CREATE FUNCTION ext.token_bytes() RETURNS text LANGUAGE sql
    AS $$ SELECT 'tok' $$;
  CREATE FUNCTION public.gen_token() RETURNS text LANGUAGE sql
    AS $$ SELECT token_bytes() $$;
  CREATE SCHEMA app;
  CREATE FUNCTION app.upper(text) RETURNS text LANGUAGE sql
    AS $$ SELECT 'SHADOWED' $$;
  CREATE TABLE public.invitations (id integer);
`;
const DESIRED = /* sql */ `
  SET search_path = public, ext;
  ALTER TABLE public.invitations
    ADD COLUMN token text NOT NULL DEFAULT public.gen_token(),
    ADD COLUMN label text NOT NULL DEFAULT upper('x');
`;

describe("apply search_path", () => {
  let target: TestDb;
  let desired: TestDb;

  beforeAll(async () => {
    target = await createTestDb("apply_sp_target");
    desired = await createTestDb("apply_sp_desired");
    await target.pool.query(BASE);
    await target.pool.query("INSERT INTO public.invitations VALUES (1)");
    await desired.pool.query(BASE);
    await desired.pool.query(DESIRED);
  }, 120_000);

  afterAll(async () => {
    await target.drop();
    await desired.drop();
  });

  test("keeps the applier path reachable behind pg_catalog", async () => {
    const p = plan(
      (await extract(target.pool)).factBase,
      (await extract(desired.pool)).factBase,
    );
    // The applier's role path lists a shadowing schema BEFORE pg_catalog.
    const pool = new pg.Pool({
      connectionString: target.uri,
      options: "-c search_path=app,pg_catalog,public,ext",
      max: 2,
    });
    pool.on("error", () => {});
    try {
      const report = await apply(p, pool);
      expect(report).toMatchObject({ status: "applied" });
    } finally {
      await pool.end().catch(() => {});
    }
    const { rows } = await target.pool.query(
      "SELECT token, label FROM public.invitations",
    );
    expect(rows).toEqual([{ token: "tok", label: "X" }]);
  });
});
