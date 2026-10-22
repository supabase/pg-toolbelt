/**
 * #339: role rename + a user mapping hidden from a non-superuser extractor.
 *
 * `ALTER ROLE old RENAME TO new` carries the role's user mapping by OID.
 * When the extracting role cannot read `pg_user_mapping`, extraction skips the
 * mapping and emits a USER_MAPPING_UNREADABLE diagnostic naming the PHYSICAL
 * role. `plan()` normalizes role identity into desired-name space before the
 * diff, so the gate must compare the diagnostic in that same space; before
 * the fix a source-side diagnostic (`srv/old`) missed the renamed delta
 * (`add srv/new`) and the plan emitted
 *   ALTER ROLE "old" RENAME TO "new";
 *   CREATE USER MAPPING FOR "new" SERVER "srv" ...
 * which fails at apply ("must be owner of foreign server" for a non-owner, or
 * "user mapping ... already exists" for an owner).
 *
 * Roles are cluster-global, so the source and desired sides run on an
 * isolated cluster pair, and a distinctive role config keeps the rename
 * unambiguous regardless of other tests' roles (same trick as
 * tests/role-rename-column-grant.test.ts). Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { USER_MAPPING_UNREADABLE } from "../src/core/diagnostic.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import {
  type Cluster,
  isolatedClusterPair,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
const pools: pg.Pool[] = [];
const rolesByCluster: Array<[Cluster, string]> = [];

const ts = Date.now();
const OLD_ROLE = `umren_old_${ts}`;
const NEW_ROLE = `umren_new_${ts}`;
const EXTRACTOR = `umren_ci_${ts}`;
const PASSWORD = "umrencipwd";
const SERVER = "umren_srv";

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end().catch(() => {})));
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
  for (const [cluster, role] of rolesByCluster) {
    await cluster.adminPool
      .query(`DROP ROLE IF EXISTS "${role}"`)
      .catch(() => {});
  }
});

async function createRoles(cluster: Cluster, mappedRole: string) {
  // The mapped role: a distinctive config makes it the only rename candidate.
  await cluster.adminPool.query(`CREATE ROLE "${mappedRole}" NOLOGIN`);
  await cluster.adminPool.query(
    `ALTER ROLE "${mappedRole}" SET statement_timeout = '33917ms'`,
  );
  // The extractor: a plain NOSUPERUSER login with no USAGE on the server and
  // no membership in the mapped role, so pg_user_mappings hides the options.
  await cluster.adminPool.query(
    `CREATE ROLE "${EXTRACTOR}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER`,
  );
  rolesByCluster.push([cluster, mappedRole], [cluster, EXTRACTOR]);
}

async function seedMapping(db: TestDb, mappedRole: string) {
  await db.pool.query(`
    CREATE FOREIGN DATA WRAPPER umren_fdw;
    CREATE SERVER ${SERVER} FOREIGN DATA WRAPPER umren_fdw;
    CREATE USER MAPPING FOR "${mappedRole}" SERVER ${SERVER}
      OPTIONS ("user" 'finance_readonly');
  `);
}

function extractorPool(db: TestDb): pg.Pool {
  const uri = db.uri.replace(
    "postgres://test:test@",
    `postgres://${EXTRACTOR}:${PASSWORD}@`,
  );
  const pool = new pg.Pool({ connectionString: uri, max: 2 });
  pool.on("error", () => {});
  pools.push(pool);
  return pool;
}

describe("unreadable user mapping under a role rename (#339)", () => {
  test("refuses in both hidden directions; plans a bare rename when nothing is hidden", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();
    const srcDb = await clusterA.createDb("umren_src");
    const dstDb = await clusterB.createDb("umren_dst");
    dbs.push(srcDb, dstDb);

    await createRoles(clusterA, OLD_ROLE);
    await createRoles(clusterB, NEW_ROLE);
    await seedMapping(srcDb, OLD_ROLE);
    await seedMapping(dstDb, NEW_ROLE);

    const [srcAdmin, dstAdmin, srcHidden, dstHidden] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
      extract(extractorPool(srcDb)),
      extract(extractorPool(dstDb)),
    ]);

    // Precondition: the limited extractor really cannot see the mapping, and
    // its diagnostic names the PHYSICAL role on each side.
    const hiddenSubjects = (r: typeof srcHidden) =>
      r.factBase.diagnostics
        .filter((d) => d.code === USER_MAPPING_UNREADABLE)
        .map((d) => d.subject);
    expect(hiddenSubjects(srcHidden)).toEqual([
      { kind: "userMapping", server: SERVER, role: OLD_ROLE },
    ]);
    expect(hiddenSubjects(dstHidden)).toEqual([
      { kind: "userMapping", server: SERVER, role: NEW_ROLE },
    ]);

    const mappingLine = new RegExp(`${SERVER}/${NEW_ROLE} \\(mapping\\)`);

    // Source hidden (the realistic CI direction). RED before the fix: planned
    // a CREATE USER MAPPING for the renamed role instead of refusing.
    expect(() =>
      plan(srcHidden.factBase, dstAdmin.factBase, { renames: "auto" }),
    ).toThrow(mappingLine);

    // Desired hidden: already refused before the fix; pinned here.
    expect(() =>
      plan(srcAdmin.factBase, dstHidden.factBase, { renames: "auto" }),
    ).toThrow(mappingLine);

    // Control: nothing hidden. PostgreSQL carries the mapping across the
    // rename by OID, so the plan is the bare rename with no mapping action,
    // and the proof loop confirms it converges.
    const thePlan = plan(srcAdmin.factBase, dstAdmin.factBase, {
      renames: "auto",
    });
    const sql = thePlan.actions.map((a) => a.sql);
    expect(sql).toContain(`ALTER ROLE "${OLD_ROLE}" RENAME TO "${NEW_ROLE}"`);
    expect(sql.filter((s) => s.includes("USER MAPPING"))).toEqual([]);

    // provePlan applies the plan to srcDb, and roles are cluster-global, so
    // cluster A now holds NEW_ROLE; drop it in afterAll too.
    rolesByCluster.push([clusterA, NEW_ROLE]);
    const verdict = await provePlan(thePlan, srcDb.pool, dstAdmin.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});
