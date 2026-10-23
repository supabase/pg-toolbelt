/**
 * The assumed-schema ambient exemption must not cover objects that DON'T exist
 * on the target (PR #307 review #3499413404). A managed object that references a
 * NEW object in an assumed schema (e.g. `auth.extra`) which is absent from the
 * target is kept reference-only on the desired side, so its creation is
 * suppressed; the requirement guard previously treated any id in an assumed
 * schema as ambient and let the dependent plan through, only to fail at apply
 * time against the missing relation. The dependent is instead skipped at PLAN
 * time with an `excluded-by-cascade` warning (its prerequisite is withheld and
 * absent). An existing assumed-schema object (`auth.users`-style, present on
 * the target) stays satisfied via `source.has`.
 *
 * The fail-fast must NOT cover PLATFORM-provisioned members of assumed schemas
 * (Sentry SUPABASE-API-8CX): a DB-webhook trigger depends on
 * `supabase_functions.http_request()`, which is owned by
 * `supabase_functions_admin` (an assumed system role) and provisioned by the
 * platform — a target that has never had webhooks enabled lacks it, yet the
 * plan must go through. Ownership by an assumed role other than the default
 * owner is the discriminator (user objects are owned by `postgres`/user roles).
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { encodeId } from "../src/core/stable-id.ts";
import { plan } from "../src/plan/plan.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import { sharedCluster, type TestDb } from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

/** Plans the target towards the desired state under the Supabase policy,
 *  applies the plan to the target, then re-plans the applied target. */
async function planApplyReplan(
  name: string,
  targetSql: string,
  desiredSql: string,
) {
  const cluster = await sharedCluster();
  const source = await cluster.createDb(`${name}_src`);
  const desired = await cluster.createDb(`${name}_dst`);
  dbs.push(source, desired);
  await source.pool.query(targetSql);
  await desired.pool.query(desiredSql);
  const [sourceState, desiredState] = await Promise.all([
    extract(source.pool),
    extract(desired.pool),
  ]);
  const thePlan = plan(sourceState.factBase, desiredState.factBase, {
    policy: supabasePolicy,
  });
  const report = await apply(thePlan, source.pool, { fingerprintGate: false });
  const applied = await extract(source.pool);
  const replan = plan(applied.factBase, desiredState.factBase, {
    policy: supabasePolicy,
  });
  const skipped = (thePlan.diagnostics ?? [])
    .filter((d) => d.code === "excluded-by-cascade")
    .map((d) => (d.subject === undefined ? "" : encodeId(d.subject)))
    .sort();
  return {
    sql: thePlan.actions.map((a) => a.sql),
    skipped,
    status: report.status,
    replanSql: replan.actions.map((a) => a.sql),
    target: source,
  };
}

describe("assumed-schema requirement guard", () => {
  test("a managed dependent on a non-existent assumed-schema object is skipped at plan time", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("assumed_req_src");
    const desired = await cluster.createDb("assumed_req_dst");
    dbs.push(source, desired);

    // target has the assumed schema but NOT `auth.extra`.
    await source.pool.query(`CREATE SCHEMA auth`);
    // desired adds `auth.extra` (filtered to reference-only by the profile) and a
    // managed public view that depends on it.
    await desired.pool.query(`
      CREATE SCHEMA auth;
      CREATE TABLE auth.extra (id integer);
      CREATE VIEW public.needs_extra AS SELECT id FROM auth.extra;
    `);

    const [sourceState, desiredState] = await Promise.all([
      extract(source.pool),
      extract(desired.pool),
    ]);

    // Planning `CREATE VIEW public.needs_extra` would fail at apply against the
    // missing relation.
    const thePlan = plan(sourceState.factBase, desiredState.factBase, {
      policy: supabasePolicy,
    });
    expect(thePlan.actions.some((a) => /needs_extra/.test(a.sql))).toBe(false);
    expect(
      (thePlan.diagnostics ?? []).map((d) => [
        d.code,
        d.context?.["requirement"],
      ]),
    ).toContainEqual(["excluded-by-cascade", "column:auth.extra.id"]);
  }, 120_000);

  test("a DB-webhook trigger plans when the target lacks the platform's supabase_functions infra", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("webhook_req_src");
    const desired = await cluster.createDb("webhook_req_dst");
    dbs.push(source, desired);

    // The system role is cluster-global on the shared test cluster.
    await source.pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_functions_admin') THEN
          CREATE ROLE supabase_functions_admin;
        END IF;
      END $$;
    `);

    // target: the table exists, webhooks were never provisioned.
    await source.pool.query(`CREATE TABLE public.deliverable (id integer)`);
    // desired: the platform provisioned the webhooks infra (schema + function
    // owned by the system role, as the Supabase image ships it) and the user
    // added a DB-webhook trigger.
    await desired.pool.query(`
      CREATE TABLE public.deliverable (id integer);
      CREATE SCHEMA supabase_functions;
      CREATE FUNCTION supabase_functions.http_request() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
      ALTER FUNCTION supabase_functions.http_request() OWNER TO supabase_functions_admin;
      CREATE TRIGGER "CRUD Deliverables sync out"
        AFTER INSERT OR UPDATE ON public.deliverable FOR EACH ROW
        EXECUTE FUNCTION supabase_functions.http_request('https://example.com/webhook', 'POST');
    `);

    const [sourceState, desiredState] = await Promise.all([
      extract(source.pool),
      extract(desired.pool),
    ]);

    // RED before the fix (Sentry SUPABASE-API-8CX): missing requirement —
    // "depends on function:supabase_functions.http_request() … (a filter may
    // be hiding its creation)". The system-role-owned platform function is
    // present at apply time by platform guarantee.
    const thePlan = plan(sourceState.factBase, desiredState.factBase, {
      policy: supabasePolicy,
    });
    expect(
      thePlan.actions.some((a) =>
        /CREATE TRIGGER "CRUD Deliverables sync out"/.test(a.sql),
      ),
    ).toBe(true);
    // the plan never tries to create the platform function itself
    expect(
      thePlan.actions.some((a) => /CREATE (OR REPLACE )?FUNCTION/i.test(a.sql)),
    ).toBe(false);
  }, 120_000);

  test("a NOT NULL column whose default needs an absent assumed-schema function is skipped whole", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("notnull_default_src");
    const desired = await cluster.createDb("notnull_default_dst");
    dbs.push(source, desired);

    // target: the table is populated, and `auth.make_id()` was never created.
    await source.pool.query(`
      CREATE SCHEMA auth;
      CREATE TABLE public.t (id integer);
      INSERT INTO public.t (id) VALUES (1), (2);
    `);
    // desired: a NOT NULL column defaulting to an auth-schema function the
    // profile keeps reference-only, plus a nullable one for contrast.
    await desired.pool.query(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.make_id() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
      CREATE TABLE public.t (
        id integer,
        n integer NOT NULL DEFAULT auth.make_id(),
        m integer DEFAULT auth.make_id()
      );
    `);

    const [sourceState, desiredState] = await Promise.all([
      extract(source.pool),
      extract(desired.pool),
    ]);

    const thePlan = plan(sourceState.factBase, desiredState.factBase, {
      policy: supabasePolicy,
    });
    // RED before the fix: `ALTER TABLE "public"."t" ADD COLUMN "n" integer NOT
    // NULL` with only a warning, which apply rejects with `column "n" of
    // relation "t" contains null values`. The nullable column still arrives.
    expect(thePlan.actions.map((a) => a.sql)).toEqual([
      `ALTER TABLE "public"."t" ADD COLUMN "m" integer`,
    ]);
    expect(
      (thePlan.diagnostics ?? []).map((d) => [
        d.code,
        d.subject === undefined ? "" : encodeId(d.subject),
      ]),
    ).toContainEqual(["excluded-by-cascade", "column:public.t.n"]);

    const report = await apply(thePlan, source.pool, {
      fingerprintGate: false,
    });
    expect(report.status).toBe("applied");
    const rows = await source.pool.query(
      `SELECT count(*)::int AS c FROM public.t`,
    );
    expect(rows.rows[0].c).toBe(2);
  }, 120_000);

  test("an existing NOT NULL column keeps its other changes when only its default is withheld", async () => {
    // CLI-2342 flow: the column already exists without its default, and the
    // desired state also retypes it.
    const r = await planApplyReplan(
      "existing_col_default",
      `
        CREATE SCHEMA auth;
        CREATE TABLE public.t (id integer, n integer NOT NULL);
        INSERT INTO public.t VALUES (1, 1);
      `,
      `
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.make_id() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
        CREATE TABLE public.t (id integer, n bigint NOT NULL DEFAULT auth.make_id());
      `,
    );
    expect(r.sql.some((s) => /ALTER COLUMN "n" TYPE bigint/.test(s))).toBe(
      true,
    );
    expect(r.sql.some((s) => /make_id/.test(s))).toBe(false);
    expect(r.skipped).toEqual(["default:public.t.n"]);
    expect(r.status).toBe("applied");
    expect(r.replanSql).toEqual([]);
  }, 120_000);

  test("a new domain-typed column is skipped with its withheld default", async () => {
    // Both domains reject NULL, so `ADD COLUMN` without the default fails on
    // the existing row.
    const domains = `
      CREATE DOMAIN public.nn AS integer NOT NULL;
      CREATE DOMAIN public.checked AS integer CHECK (VALUE IS NOT NULL);
    `;
    const r = await planApplyReplan(
      "domain_col_default",
      `
        CREATE SCHEMA auth;
        ${domains}
        CREATE TABLE public.t (id integer);
        INSERT INTO public.t VALUES (1);
      `,
      `
        CREATE SCHEMA auth;
        ${domains}
        CREATE FUNCTION auth.make_id() RETURNS integer LANGUAGE sql AS $$ SELECT 7 $$;
        CREATE TABLE public.t (
          id integer,
          k public.nn DEFAULT auth.make_id(),
          c public.checked DEFAULT auth.make_id()
        );
      `,
    );
    expect(r.sql).toEqual([]);
    expect(r.skipped).toEqual([
      "column:public.t.c",
      "column:public.t.k",
      "default:public.t.c",
      "default:public.t.k",
    ]);
    expect(r.status).toBe("applied");
    expect(r.replanSql).toEqual([]);
  }, 120_000);

  test("a partitioned table is skipped when its partition key column is", async () => {
    const r = await planApplyReplan(
      "partition_key_col",
      `CREATE SCHEMA auth;`,
      `
        CREATE SCHEMA auth;
        CREATE TYPE auth.k AS ENUM ('a');
        CREATE TABLE public.pt (id integer, k auth.k) PARTITION BY LIST (k);
        CREATE TABLE public.plain (id integer);
      `,
    );
    expect(r.sql).toContain(`CREATE TABLE "public"."plain" ("id" integer)`);
    expect(r.sql.filter((s) => /"pt"/.test(s))).toEqual([]);
    expect(r.skipped).toEqual(["column:public.pt.k", "table:public.pt"]);
    expect(r.status).toBe("applied");
    expect(r.replanSql).toEqual([]);
  }, 120_000);

  test("a new table is skipped when its replica identity index is", async () => {
    const r = await planApplyReplan(
      "replident_index",
      `CREATE SCHEMA auth;`,
      `
        CREATE SCHEMA auth;
        CREATE TYPE auth.k AS ENUM ('a');
        CREATE TABLE public.ri (id integer, k auth.k NOT NULL);
        CREATE UNIQUE INDEX ri_k ON public.ri (k);
        ALTER TABLE public.ri REPLICA IDENTITY USING INDEX ri_k;
        CREATE TABLE public.rc (id integer, k auth.k NOT NULL);
        ALTER TABLE public.rc ADD CONSTRAINT rc_k UNIQUE (k);
        ALTER TABLE public.rc REPLICA IDENTITY USING INDEX rc_k;
      `,
    );
    expect(r.sql).toEqual([]);
    expect(r.skipped).toEqual([
      "column:public.rc.k",
      "column:public.ri.k",
      "constraint:public.rc.rc_k",
      "index:public.ri_k",
      "table:public.rc",
      "table:public.ri",
    ]);
    expect(r.status).toBe("applied");
    expect(r.replanSql).toEqual([]);
  }, 120_000);

  test("a new NOT NULL column with a withheld default and a foreign key to a withheld table is skipped with its constraint", async () => {
    // The pgsodium shape: key_id uuid NOT NULL DEFAULT … REFERENCES pgsodium.key.
    const r = await planApplyReplan(
      "notnull_fk_col",
      `
        CREATE SCHEMA auth;
        CREATE TABLE public.t (id integer);
        INSERT INTO public.t VALUES (1);
      `,
      `
        CREATE SCHEMA auth;
        CREATE TABLE auth.keys (id uuid PRIMARY KEY);
        CREATE FUNCTION auth.make_key() RETURNS uuid LANGUAGE sql
          AS $$ SELECT gen_random_uuid() $$;
        CREATE TABLE public.t (
          id integer,
          key_id uuid NOT NULL DEFAULT auth.make_key() REFERENCES auth.keys (id)
        );
      `,
    );
    expect(r.sql).toEqual([]);
    expect(r.skipped).toEqual([
      "column:public.t.key_id",
      "constraint:public.t.t_key_id_fkey",
      "default:public.t.key_id",
    ]);
    expect(r.status).toBe("applied");
    expect(r.replanSql).toEqual([]);
  }, 120_000);
});
