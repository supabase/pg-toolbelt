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
import { createTestDb, isolatedClusterPair } from "./containers.ts";

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

  // ── Gap 1: isolatedCluster mode ──────────────────────────────────────────

  test("isolatedCluster mode: role-creating file loads successfully", async () => {
    const [clusterA] = await isolatedClusterPair();
    const shadow = await clusterA.createDb("shadow_iso");
    const baselineRoles = await clusterA.listRoles();
    try {
      const result = await loadSqlFiles(
        [{ name: "roles.sql", sql: "CREATE ROLE iso_role_test NOLOGIN;" }],
        shadow.pool,
        { mode: "isolatedCluster" },
      );
      // loading must succeed without throwing
      expect(result.rounds).toBeGreaterThanOrEqual(1);
    } finally {
      await clusterA.dropRolesExcept(baselineRoles);
      await shadow.drop();
    }
  }, 60_000);

  test("isolatedCluster mode: same role-creating file FAILS in databaseScratch mode", async () => {
    const shadow = await createTestDb("shadow_scratch");
    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "roles.sql",
              sql: "CREATE ROLE scratch_role_leak_test NOLOGIN;",
            },
          ],
          shadow.pool,
          { mode: "databaseScratch" },
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      expect(String(error)).toMatch(/cluster-level/);
    } finally {
      await shadow.pool
        .query("DROP ROLE IF EXISTS scratch_role_leak_test")
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  // ── Gap 2: pg_auth_members leak detection ────────────────────────────────

  test("pg_auth_members leak: GRANT between pre-existing roles is detected in databaseScratch mode", async () => {
    // We need two pre-existing roles on the shared cluster.
    // Create them ahead of time, then attempt a GRANT in a file.
    const shadow = await createTestDb("shadow_membership");
    const sharedPool = shadow.cluster.adminPool;

    // Set up two roles on the shared cluster before loading
    await sharedPool
      .query("CREATE ROLE membership_role_a NOLOGIN")
      .catch(() => {});
    await sharedPool
      .query("CREATE ROLE membership_role_b NOLOGIN")
      .catch(() => {});

    try {
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "grant.sql",
              // GRANT role_a TO role_b adds a pg_auth_members row without creating a new role
              sql: "GRANT membership_role_a TO membership_role_b;",
            },
          ],
          shadow.pool,
          { mode: "databaseScratch" },
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      // Must mention cluster-level or membership leak
      expect(String(error)).toMatch(/cluster-level|membership/i);
    } finally {
      await sharedPool
        .query("DROP ROLE IF EXISTS membership_role_b")
        .catch(() => {});
      await sharedPool
        .query("DROP ROLE IF EXISTS membership_role_a")
        .catch(() => {});
      await shadow.drop();
    }
  }, 60_000);

  // ── Gap 3: provenance tag ────────────────────────────────────────────────

  test("provenance: loaded factBase.source === 'sqlFiles'", async () => {
    const shadow = await createTestDb("shadow_provenance");
    try {
      const result = await loadSqlFiles(
        [
          {
            name: "schema.sql",
            sql: "CREATE TABLE public.prov_test (id integer PRIMARY KEY);",
          },
        ],
        shadow.pool,
      );
      expect(result.factBase.source).toBe("sqlFiles");
    } finally {
      await shadow.drop();
    }
  }, 60_000);

  // ── Gap 4: mutual-FK split diagnostic ───────────────────────────────────

  test("mutual-FK: two tables referencing each other inline get a split-FK hint", async () => {
    const shadow = await createTestDb("shadow_mutualfk");
    try {
      // a.sql creates table_a referencing table_b; b.sql creates table_b referencing table_a
      // Neither can load first because the other doesn't exist yet.
      const error = await captureError(
        loadSqlFiles(
          [
            {
              name: "a.sql",
              sql: `CREATE TABLE public.table_a (
                id integer PRIMARY KEY,
                b_id integer REFERENCES public.table_b(id)
              );`,
            },
            {
              name: "b.sql",
              sql: `CREATE TABLE public.table_b (
                id integer PRIMARY KEY,
                a_id integer REFERENCES public.table_a(id)
              );`,
            },
          ],
          shadow.pool,
        ),
      );
      expect(error).toBeInstanceOf(ShadowLoadError);
      const msg = String(error);
      expect(msg).toMatch(/stuck/);
      // Must include the split-FK remediation hint
      expect(msg).toMatch(/ALTER TABLE|split/i);
    } finally {
      await shadow.drop();
    }
  }, 60_000);
});
