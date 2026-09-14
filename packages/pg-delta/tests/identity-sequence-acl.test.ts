/**
 * Privileges on the sequence behind a `GENERATED … AS IDENTITY` column are
 * facts: extracted as `acl` satellites of the column (target = the backing
 * sequence), planned as GRANT / REVOKE ON SEQUENCE, and exported into the
 * owning table's file so `load(export(db))` keeps them.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { extract } from "../src/extract/extract.ts";
import { exportSqlFiles } from "../src/frontends/export-sql-files.ts";
import { loadSqlFiles } from "../src/frontends/load-sql-files.ts";
import { plan } from "../src/plan/plan.ts";
import { sharedCluster } from "./containers.ts";

const SEQ_ACL = `
  SELECT COALESCE(r.rolname, 'PUBLIC') AS grantee,
         string_agg(a.privilege_type, ',' ORDER BY a.privilege_type) AS privs
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(c.relacl) a
  LEFT JOIN pg_roles r ON r.oid = a.grantee
  WHERE n.nspname = 'app' AND c.relname = 't_id_seq'
  GROUP BY 1 ORDER BY 1`;

async function withRole<T>(
  admin: pg.Pool,
  fn: (role: string) => Promise<T>,
): Promise<T> {
  const role = `idseq_r_${crypto.randomUUID().slice(0, 8)}`;
  await admin.query(`CREATE ROLE "${role}" NOLOGIN`);
  try {
    return await fn(role);
  } finally {
    await admin.query(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
  }
}

const IDENTITY_TABLE = `
  CREATE SCHEMA app;
  CREATE TABLE app.t (id bigint GENERATED ALWAYS AS IDENTITY, v int);
`;

describe("identity-column sequence privileges", () => {
  test("extract models a grant on the identity sequence as an acl satellite of the column", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("idseq_extract");
    try {
      await withRole(cluster.adminPool, async (role) => {
        await db.pool.query(IDENTITY_TABLE);
        await db.pool.query(
          `GRANT USAGE ON SEQUENCE app.t_id_seq TO "${role}"`,
        );
        const fb = (await extract(db.pool)).factBase;
        const seqAcls = fb.facts().filter((f) => {
          if (f.id.kind !== "acl") return false;
          const target = f.id.target;
          return target.kind === "sequence" && target.name === "t_id_seq";
        });
        const granted = seqAcls.find(
          (f) => f.id.kind === "acl" && f.id.grantee === role,
        );
        expect(granted).toBeDefined();
        expect(granted!.payload["privileges"]).toEqual(["USAGE"]);
        expect(granted!.parent).toEqual({
          kind: "column",
          schema: "app",
          table: "t",
          name: "id",
        });
        // the owner's default on its own sequence is a fact too, marked with
        // its create-time default set so the planner can elide it on create and
        // restore it when the source owner had revoked part of it
        const owner = seqAcls.find(
          (f) => f.id.kind === "acl" && f.id.grantee !== role,
        );
        expect(owner).toBeDefined();
        expect(owner!.payload["_ownerDefault"]).toEqual(
          owner!.payload["privileges"],
        );
      });
    } finally {
      await db.drop();
    }
  }, 120_000);

  test("plan grants and revokes the identity sequence privilege between databases", async () => {
    const cluster = await sharedCluster();
    const without = await cluster.createDb("idseq_plan_a");
    const withGrant = await cluster.createDb("idseq_plan_b");
    try {
      await withRole(cluster.adminPool, async (role) => {
        await without.pool.query(IDENTITY_TABLE);
        await withGrant.pool.query(IDENTITY_TABLE);
        await withGrant.pool.query(
          `GRANT USAGE ON SEQUENCE app.t_id_seq TO "${role}"`,
        );
        const a = (await extract(without.pool)).factBase;
        const b = (await extract(withGrant.pool)).factBase;
        const forward = plan(a, b).actions.map((x) => x.sql);
        const reverse = plan(b, a).actions.map((x) => x.sql);
        expect(forward).toContain(
          `GRANT USAGE ON SEQUENCE "app"."t_id_seq" TO "${role}"`,
        );
        expect(reverse).toContain(
          `REVOKE ALL ON SEQUENCE "app"."t_id_seq" FROM "${role}"`,
        );
      });
    } finally {
      await Promise.all([without.drop(), withGrant.drop()]);
    }
  }, 120_000);

  test("restoring the owner's default on the identity sequence grants it back", async () => {
    const cluster = await sharedCluster();
    const revoked = await cluster.createDb("idseq_owner_a");
    const restored = await cluster.createDb("idseq_owner_b");
    try {
      await revoked.pool.query(IDENTITY_TABLE);
      await revoked.pool.query(
        "REVOKE UPDATE ON SEQUENCE app.t_id_seq FROM CURRENT_USER",
      );
      await restored.pool.query(IDENTITY_TABLE);
      const a = (await extract(revoked.pool)).factBase;
      const b = (await extract(restored.pool)).factBase;
      const forward = plan(a, b);
      for (const action of forward.actions) {
        await revoked.pool.query(action.sql);
      }
      // the test role is a superuser, so has_sequence_privilege() would be
      // true regardless: read the ACL itself
      const owner = (await revoked.pool.query("SELECT current_user AS r"))
        .rows[0].r as string;
      const acl = await revoked.pool.query(SEQ_ACL);
      expect(acl.rows).toContainEqual({
        grantee: owner,
        privs: "SELECT,UPDATE,USAGE",
      });
      expect((await extract(revoked.pool)).factBase.rootHash).toBe(b.rootHash);
    } finally {
      await Promise.all([revoked.drop(), restored.drop()]);
    }
  }, 120_000);

  test("export/load keeps an owner's partial revoke on a co-created identity sequence", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("idseq_owner_src");
    const shadow = await cluster.createDb("idseq_owner_shadow");
    try {
      await source.pool.query(IDENTITY_TABLE);
      await source.pool.query(
        "REVOKE UPDATE ON SEQUENCE app.t_id_seq FROM CURRENT_USER",
      );
      const fb = (await extract(source.pool)).factBase;
      const files = exportSqlFiles(fb).filter(
        (f) => !f.name.startsWith("_cluster/roles"),
      );
      const loaded = await loadSqlFiles(files, shadow.pool);
      const owner = (await shadow.pool.query("SELECT current_user AS r"))
        .rows[0].r as string;
      const acl = await shadow.pool.query(SEQ_ACL);
      expect(acl.rows).toContainEqual({
        grantee: owner,
        privs: "SELECT,USAGE",
      });
      expect(loaded.factBase.rootHash).toBe(fb.rootHash);
    } finally {
      await Promise.all([source.drop(), shadow.drop()]);
    }
  }, 120_000);

  test("export files the sequence grant with its table and load reproduces it", async () => {
    const cluster = await sharedCluster();
    const source = await cluster.createDb("idseq_src");
    const shadow = await cluster.createDb("idseq_shadow");
    try {
      await withRole(cluster.adminPool, async (role) => {
        await source.pool.query(IDENTITY_TABLE);
        await source.pool.query(
          `GRANT USAGE ON SEQUENCE app.t_id_seq TO "${role}"`,
        );
        const fb = (await extract(source.pool)).factBase;
        // the role is cluster-global on the shared cluster: keep it out of the load
        const files = exportSqlFiles(fb).filter(
          (f) => !f.name.startsWith("_cluster/roles"),
        );
        const table = files.find((f) => f.name === "app/tables/t.sql");
        expect(table).toBeDefined();
        expect(table!.sql).toContain(
          `GRANT USAGE ON SEQUENCE "app"."t_id_seq" TO "${role}"`,
        );
        expect(files.some((f) => f.name.includes("/sequences/"))).toBe(false);

        const loaded = await loadSqlFiles(files, shadow.pool);
        expect(loaded.factBase.rootHash).toBe(fb.rootHash);
        const acl = await shadow.pool.query(SEQ_ACL);
        expect(acl.rows).toContainEqual({ grantee: role, privs: "USAGE" });
      });
    } finally {
      await Promise.all([source.drop(), shadow.drop()]);
    }
  }, 120_000);
});
