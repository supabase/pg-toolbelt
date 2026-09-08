/**
 * Regression (CLI-2379): a default-privileges row scoped to a per-session
 * temp schema (`ALTER DEFAULT PRIVILEGES … IN SCHEMA pg_temp_N`) must not be
 * extracted. `pg_temp_N` is a backend-scoped catalog artifact — the schema
 * family never emits it (USER_SCHEMA_FILTER), it exists on no target, and no
 * plan can produce it — so a `defaultPrivilege` fact keyed on it can only ever
 * surface as a `missing requirement` in buildActionGraph.
 *
 * The row is only visible while the backend that owns the temp namespace is
 * alive (Postgres drops it with the namespace contents at backend exit), so the
 * test pins a dedicated client for the duration of the extraction.
 *
 * Docker required.
 */
import { describe, expect, test } from "bun:test";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { createTestDb } from "./containers.ts";

describe("default privileges — pg_temp-scoped rows", () => {
  test("a live session's pg_temp_N default ACL is invisible to extract and plan", async () => {
    const source = await createTestDb("dptemp_src");
    const desired = await createTestDb("dptemp_dst");
    const session = await desired.pool.connect();
    try {
      await desired.pool.query("CREATE ROLE dptemp_reader NOLOGIN");
      // The temp namespace only materializes once the session creates a temp
      // object; its name is per-backend, hence the dynamic lookup.
      await session.query("CREATE TEMP TABLE dptemp_scratch(x int)");
      await session.query(`
        DO $$ BEGIN
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO dptemp_reader',
            (SELECT nspname FROM pg_namespace WHERE oid = pg_my_temp_schema()));
        END $$`);
      const probe = await desired.pool.query(
        `SELECT n.nspname FROM pg_default_acl d
         JOIN pg_namespace n ON n.oid = d.defaclnamespace
         WHERE n.nspname LIKE 'pg\\_temp%'`,
      );
      expect(probe.rows).toHaveLength(1);

      const from = await extract(source.pool);
      const to = await extract(desired.pool);

      const tempScoped = to.factBase
        .facts()
        .filter(
          (f) =>
            f.id.kind === "defaultPrivilege" &&
            (f.id.schema ?? "").startsWith("pg_temp"),
        );
      expect(tempScoped).toEqual([]);

      const planned = plan(from.factBase, to.factBase);
      expect(planned.actions.map((a) => a.sql)).toEqual([]);
    } finally {
      session.release();
      await source.drop();
      await desired.drop();
      await desired.cluster.adminPool
        .query("DROP ROLE IF EXISTS dptemp_reader")
        .catch(() => {});
    }
  }, 60_000);
});
