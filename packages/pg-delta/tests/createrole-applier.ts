import pg from "pg";
import type { Cluster, TestDb } from "./containers.ts";

/** Login used when `meta.createroleApplier` is set. Same name on both sides
 *  so the role fact cancels in the diff. */
const CREATEROLE_APPLIER = "crl_applier";
const CREATEROLE_APPLIER_PASSWORD = "crl";

export async function ensureCreateroleApplier(cluster: Cluster): Promise<void> {
  await cluster.adminPool.query(`DROP ROLE IF EXISTS "${CREATEROLE_APPLIER}"`);
  await cluster.adminPool.query(
    `CREATE ROLE "${CREATEROLE_APPLIER}" LOGIN PASSWORD '${CREATEROLE_APPLIER_PASSWORD}' CREATEROLE NOSUPERUSER INHERIT`,
  );
  await cluster.adminPool.query(
    `GRANT "${CREATEROLE_APPLIER}" TO CURRENT_USER`,
  );
}

export async function grantDatabaseToCreateroleApplier(
  db: TestDb,
): Promise<void> {
  await db.cluster.adminPool.query(
    `GRANT CONNECT, CREATE ON DATABASE "${db.name}" TO "${CREATEROLE_APPLIER}"`,
  );
  await db.pool.query(`GRANT ALL ON SCHEMA public TO "${CREATEROLE_APPLIER}"`);
}

export function poolAsCreateroleApplier(db: TestDb): pg.Pool {
  const url = new URL(db.uri);
  url.username = CREATEROLE_APPLIER;
  url.password = CREATEROLE_APPLIER_PASSWORD;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5 });
  pool.on("error", () => {});
  return pool;
}
