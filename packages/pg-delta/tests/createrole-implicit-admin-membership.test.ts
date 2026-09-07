/**
 * On PG16+ a CREATEROLE non-superuser (Supabase `postgres`) that runs
 * `CREATE ROLE x` receives `GRANT x TO <creator> WITH ADMIN OPTION` whose
 * grantor is the bootstrap superuser (oid 10). Live extraction was
 * grantor-blind, so a baseline from that project planned the GRANT against
 * an empty branch and Postgres rejected it:
 *
 *   ADMIN option cannot be granted back to your own grantor  (SQLSTATE 0LP01)
 *
 * Shadow load already strips those rows (`bootstrapMembershipStrip`); this
 * file pins the same contract on live extract + apply.
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { apply } from "../src/apply/apply.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { probeApplierCapability } from "../src/policy/capability.ts";
import {
  isolatedClusterPair,
  type Cluster,
  type TestDb,
} from "./containers.ts";

const PG_MAJOR = Number(
  /postgres:(\d+)/.exec(
    process.env["PGDELTA_TEST_IMAGE"] ?? "postgres:17-alpine",
  )?.[1] ?? "17",
);

const APPLIER_PASSWORD = "applier";

let cleanup: (() => Promise<void>) | undefined;

afterAll(async () => {
  await cleanup?.();
});

async function provisionApplier(cluster: Cluster, role: string): Promise<void> {
  await cluster.adminPool.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD '${APPLIER_PASSWORD}' CREATEROLE NOSUPERUSER INHERIT`,
  );
  await cluster.adminPool.query(`GRANT "${role}" TO CURRENT_USER`);
}

async function grantDatabase(db: TestDb, role: string): Promise<void> {
  await db.cluster.adminPool.query(
    `GRANT CONNECT, CREATE ON DATABASE "${db.name}" TO "${role}"`,
  );
  await db.pool.query(`GRANT ALL ON SCHEMA public TO "${role}"`);
}

function poolAs(db: TestDb, role: string): pg.Pool {
  const url = new URL(db.uri);
  url.username = role;
  url.password = APPLIER_PASSWORD;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  pool.on("error", () => {});
  return pool;
}

describe.skipIf(PG_MAJOR < 16)(
  "PG16+ CREATEROLE implicit ADMIN membership",
  () => {
    test("baseline of roles created by a CREATEROLE user applies to an empty branch", async () => {
      const [clusterA, clusterB] = await isolatedClusterPair();
      const suffix = `${Date.now()}`;
      const applier = `crl16_app_${suffix}`;
      const created = `crl16_new_${suffix}`;
      const parent = `crl16_par_${suffix}`;
      const child = `crl16_ch_${suffix}`;
      const table = `crl16_t_${suffix}`;

      const baseA = await clusterA.listRoles();
      const baseB = await clusterB.listRoles();
      const pools: pg.Pool[] = [];
      let source: TestDb | undefined;
      let empty: TestDb | undefined;
      cleanup = async () => {
        await Promise.all(pools.map((p) => p.end().catch(() => {})));
        await Promise.all([
          source?.drop().catch(() => {}),
          empty?.drop().catch(() => {}),
        ]);
        await clusterA.dropRolesExcept(baseA);
        await clusterB.dropRolesExcept(baseB);
      };

      await provisionApplier(clusterA, applier);
      await provisionApplier(clusterB, applier);

      const sourceDb = await clusterA.createDb("crl16_src");
      const emptyDb = await clusterB.createDb("crl16_empty");
      source = sourceDb;
      empty = emptyDb;
      await grantDatabase(sourceDb, applier);
      await grantDatabase(emptyDb, applier);

      const sourcePool = poolAs(sourceDb, applier);
      const emptyPool = poolAs(emptyDb, applier);
      pools.push(sourcePool, emptyPool);

      await sourcePool.query(`
        CREATE ROLE "${created}" NOLOGIN;
        CREATE ROLE "${parent}" NOLOGIN;
        CREATE ROLE "${child}" NOLOGIN;
        GRANT "${parent}" TO "${child}";
        CREATE TABLE public."${table}" (id int);
        GRANT SELECT ON public."${table}" TO "${child}";
      `);

      // Precondition: CREATE ROLE recorded the bootstrap-superuser ADMIN grant.
      const implicit = await sourcePool.query<{
        grantor_oid: string;
        admin_option: boolean;
      }>(
        `
        SELECT m.grantor::text AS grantor_oid, m.admin_option
        FROM pg_auth_members m
        JOIN pg_roles r ON r.oid = m.roleid
        JOIN pg_roles mem ON mem.oid = m.member
        WHERE r.rolname = $1 AND mem.rolname = $2
      `,
        [created, applier],
      );
      expect(implicit.rows).toEqual([
        { grantor_oid: "10", admin_option: true },
      ]);

      const [desiredState, emptyState] = [
        await extract(sourcePool),
        await extract(emptyPool),
      ];
      const capability = await probeApplierCapability(emptyPool);
      const thePlan = plan(emptyState.factBase, desiredState.factBase, {
        capability,
      });

      const report = await apply(thePlan, emptyPool);
      expect({
        status: report.status,
        error: report.error?.message,
        sql: report.error?.sql,
      }).toEqual({ status: "applied", error: undefined, sql: undefined });

      expect(
        desiredState.factBase.has({
          kind: "membership",
          role: created,
          member: applier,
        }),
      ).toBe(false);
      expect(
        desiredState.factBase.has({
          kind: "membership",
          role: parent,
          member: child,
        }),
      ).toBe(true);

      const grantSql = thePlan.actions.map((a) => a.sql);
      expect(
        grantSql.some(
          (s) =>
            s.includes(`GRANT "${created}" TO "${applier}"`) &&
            s.includes("WITH ADMIN OPTION"),
        ),
      ).toBe(false);
      expect(
        grantSql.some((s) => s === `GRANT "${parent}" TO "${child}"`),
      ).toBe(true);
    }, 120_000);
  },
);
