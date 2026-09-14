/**
 * `load(export(live))` onto an auto-expose-ON baseline must keep live ACLs.
 * Canonical overlay roles live on a dedicated stock cluster so the shared
 * isolatedClusterPair is not mutated.
 *
 * Gated supabaseCluster cell re-GRANTs auto-expose ADP first (the committed
 * base-init fixture revokes it) and pins overlay tuples against pg_default_acl.
 */
import { afterAll, describe, expect, test } from "bun:test";
import pg from "pg";
import { extract } from "../src/extract/extract.ts";
import { buildSchemaExport } from "../src/frontends/schema-export.ts";
import {
  loadSqlFiles,
  ShadowLoadError,
} from "../src/frontends/load-sql-files.ts";
import { supabaseProfile } from "../src/integrations/supabase.ts";
import { rawProfile } from "../src/integrations/profile.ts";
import { flattenPolicy } from "../src/policy/policy.ts";
import { reconstructManagedView } from "../src/policy/reconstruct.ts";
import { supabasePolicy } from "../src/policy/supabase.ts";
import {
  runSupabaseBareTests,
  startStockCluster,
  supabaseCluster,
  type Cluster,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
const extraPools: pg.Pool[] = [];
const extraClusters: Cluster[] = [];
afterAll(async () => {
  await Promise.all(extraPools.map((p) => p.end().catch(() => {})));
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
  await Promise.all(extraClusters.map((c) => c.stop().catch(() => {})));
});

const AUTO_EXPOSE_ADP = `
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
`;

const LIVE_SQL = `
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;
CREATE FUNCTION public.get_account() RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT 1 $$;
REVOKE ALL ON FUNCTION public.get_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_account() TO authenticated;
CREATE TABLE public.select_only (id integer);
REVOKE ALL ON TABLE public.select_only FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.select_only TO authenticated;
CREATE TABLE public.full_grant (id integer);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.full_grant
  TO anon, authenticated, service_role;
`;

async function ensureApiRoles(pool: pg.Pool): Promise<void> {
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
        CREATE ROLE postgres SUPERUSER LOGIN PASSWORD 'test';
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
      END IF;
    END $$;
  `);
}

function asPostgresUri(uri: string, password = "test"): string {
  return uri.replace(/:\/\/[^@]+@/, `://postgres:${password}@`);
}

async function openPostgresPool(
  uri: string,
  password = "test",
): Promise<pg.Pool> {
  const pool = new pg.Pool({
    connectionString: asPostgresUri(uri, password),
    max: 3,
  });
  pool.on("error", () => {});
  extraPools.push(pool);
  return pool;
}

function fileSql(
  files: { name: string; sql: string }[],
  pattern: RegExp,
): string {
  return files
    .filter((f) => pattern.test(f.name))
    .map((f) => f.sql)
    .join("\n");
}

async function loadExport(
  files: { name: string; sql: string }[],
  pool: pg.Pool,
): Promise<void> {
  const assumed = flattenPolicy(supabasePolicy);
  try {
    await loadSqlFiles(files, pool, {
      mode: "isolatedCluster",
      assumedSchemas: assumed.assumedSchemas,
    });
  } catch (error) {
    if (error instanceof ShadowLoadError) {
      throw new Error(
        `${error.message}\n${error.details.map((d) => d.message).join("\n")}`,
      );
    }
    throw error;
  }
}

describe("export/load privilege round-trip (auto-expose overlay)", () => {
  test("alpine dedicated cluster: locked-down function, SELECT-only table, full-grant table", async () => {
    const cluster = await startStockCluster();
    extraClusters.push(cluster);
    const src = await cluster.createDb("priv_rt_src");
    const dest = await cluster.createDb("priv_rt_dest");
    dbs.push(src, dest);
    await ensureApiRoles(src.pool);
    await ensureApiRoles(dest.pool);
    const srcPg = await openPostgresPool(src.uri);
    const destPg = await openPostgresPool(dest.uri);
    await srcPg.query(AUTO_EXPOSE_ADP);
    await srcPg.query(LIVE_SQL);
    await destPg.query(AUTO_EXPOSE_ADP);

    const exported = await buildSchemaExport(src.pool, {
      profile: supabaseProfile,
    });
    const fnSql = fileSql(exported.files, /get_account/);
    expect(fnSql).toMatch(
      /REVOKE ALL ON FUNCTION "public"\."get_account"\(\) FROM PUBLIC, "anon"/,
    );
    expect(fnSql).not.toMatch(/GRANT EXECUTE.*TO "anon"/);

    const tableSql = fileSql(exported.files, /select_only/);
    expect(tableSql).toMatch(/REVOKE ALL ON TABLE "public"\."select_only"/);
    expect(tableSql).toContain(
      `GRANT SELECT ON TABLE "public"."select_only" TO "authenticated"`,
    );

    const fullSql = fileSql(exported.files, /full_grant/);
    expect(fullSql).toContain(
      `GRANT DELETE, INSERT, SELECT, UPDATE ON TABLE "public"."full_grant" TO "anon"`,
    );

    const adpSql = fileSql(exported.files, /default_privileges|adp_wipes/);
    expect(adpSql).toMatch(/REVOKE ALL ON FUNCTIONS FROM "anon"/);
    expect(adpSql).toMatch(/REVOKE ALL ON FUNCTIONS FROM "authenticated"/);
    expect(adpSql).toMatch(/REVOKE ALL ON TABLES FROM "anon"/);
    expect(adpSql).toContain(`GRANT SELECT ON TABLES TO "anon"`);

    await loadExport(exported.files, destPg);

    const viewOpts = {
      policy: supabasePolicy,
      scope: "database" as const,
      defaultOwner: "postgres",
    };
    const srcView = reconstructManagedView(
      (await extract(src.pool)).factBase,
      viewOpts,
    );
    const destView = reconstructManagedView(
      (await extract(dest.pool)).factBase,
      viewOpts,
    );
    const privilegeSnap = (
      view: ReturnType<typeof reconstructManagedView>,
      kind: "acl" | "defaultPrivilege",
    ) =>
      view
        .facts()
        .filter((f) => f.id.kind === kind)
        .map((f) =>
          JSON.stringify({
            id: f.id,
            privileges: f.payload["privileges"],
            grantable: f.payload["grantable"],
          }),
        )
        .sort();
    expect(privilegeSnap(srcView, "acl")).toEqual(
      privilegeSnap(destView, "acl"),
    );
    expect(privilegeSnap(srcView, "defaultPrivilege")).toEqual(
      privilegeSnap(destView, "defaultPrivilege"),
    );

    const fnAcl = destView
      .facts()
      .filter((f) => {
        if (f.id.kind !== "acl") return false;
        const target = f.id.target;
        return target.kind === "function" && target.name === "get_account";
      })
      .map((f) => (f.id.kind === "acl" ? f.id.grantee : ""))
      .sort();
    expect(fnAcl).toContain("authenticated");
    expect(fnAcl).not.toContain("anon");
  }, 180_000);

  test("alpine: identity sequence does not inherit dest overlay when live ADP is off", async () => {
    const cluster = await startStockCluster();
    extraClusters.push(cluster);
    const src = await cluster.createDb("priv_rt_id_src");
    const dest = await cluster.createDb("priv_rt_id_dest");
    dbs.push(src, dest);
    await ensureApiRoles(src.pool);
    await ensureApiRoles(dest.pool);
    const srcPg = await openPostgresPool(src.uri);
    const destPg = await openPostgresPool(dest.uri);
    await srcPg.query(`
      CREATE TABLE public.people (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY
      );
    `);
    await destPg.query(AUTO_EXPOSE_ADP);

    const exported = await buildSchemaExport(src.pool, {
      profile: supabaseProfile,
    });
    const names = exported.files.map((f) => f.name.replaceAll("\\", "/"));
    const wipeAt = names.findIndex((n) => n.endsWith("adp_wipes.sql"));
    const tableAt = names.findIndex((n) => /\/tables\//.test(n));
    expect(wipeAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeGreaterThanOrEqual(0);
    expect(wipeAt).toBeLessThan(tableAt);

    await loadExport(exported.files, destPg);

    const seqExists = await destPg.query(
      `SELECT 1 FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'people_id_seq'`,
    );
    expect(seqExists.rowCount).toBe(1);

    const overlayOnSeq = await destPg.query<{ grantee: string }>(`
      SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN LATERAL aclexplode(c.relacl) a ON c.relacl IS NOT NULL
      LEFT JOIN pg_roles g ON g.oid = a.grantee
      WHERE n.nspname = 'public' AND c.relname = 'people_id_seq'
        AND COALESCE(g.rolname, 'PUBLIC')
          IN ('anon', 'authenticated', 'service_role')
    `);
    expect(overlayOnSeq.rows).toEqual([]);
  }, 180_000);

  test("alpine: predating identity seq does not inherit a later GRANT USAGE ADP", async () => {
    const cluster = await startStockCluster();
    extraClusters.push(cluster);
    const src = await cluster.createDb("priv_rt_ident_src");
    const dest = await cluster.createDb("priv_rt_ident_dest");
    dbs.push(src, dest);
    await ensureApiRoles(src.pool);
    await ensureApiRoles(dest.pool);
    const srcPg = await openPostgresPool(src.uri);
    const destPg = await openPostgresPool(dest.uri);
    await srcPg.query(`CREATE ROLE rvc_reader NOLOGIN`);
    await srcPg.query(`
      CREATE SCHEMA app;
      CREATE TABLE app.t1 (id integer);
      CREATE TABLE app.ident (id bigint GENERATED ALWAYS AS IDENTITY);
      ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO rvc_reader;
      ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE ON SEQUENCES TO rvc_reader;
      CREATE TABLE app.t2 (id integer);
      CREATE TABLE app.ident2 (id bigint GENERATED ALWAYS AS IDENTITY);
    `);

    const exported = await buildSchemaExport(src.pool, { profile: rawProfile });
    await loadExport(exported.files, destPg);

    const relGrantees = async (schema: string, rel: string, role: string) => {
      const r = await destPg.query<{ grantee: string; priv: string }>(
        `SELECT COALESCE(g.rolname, 'PUBLIC') AS grantee, a.privilege_type AS priv
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN LATERAL aclexplode(c.relacl) a ON c.relacl IS NOT NULL
         LEFT JOIN pg_roles g ON g.oid = a.grantee
         WHERE n.nspname = $1 AND c.relname = $2
           AND COALESCE(g.rolname, 'PUBLIC') = $3`,
        [schema, rel, role],
      );
      return r.rows.map((row) => row.priv).sort();
    };
    // The positive GRANT ADP loads after the tables, so ident_id_seq (created
    // before the ADP on the source) is not injected into; ident2_id_seq keeps
    // its USAGE through the identity-sequence acl fact carried by its column.
    expect(await relGrantees("app", "ident_id_seq", "rvc_reader")).toEqual([]);
    expect(await relGrantees("app", "ident2_id_seq", "rvc_reader")).toEqual([
      "USAGE",
    ]);
    expect(await relGrantees("app", "t1", "rvc_reader")).toEqual([]);
    expect(await relGrantees("app", "t2", "rvc_reader")).toEqual(["SELECT"]);
  }, 180_000);

  test("alpine: overlay wipes run before CREATE EXTENSION so trgm members stay clean", async () => {
    const cluster = await startStockCluster();
    extraClusters.push(cluster);
    const src = await cluster.createDb("priv_rt_trgm_src");
    const dest = await cluster.createDb("priv_rt_trgm_dest");
    dbs.push(src, dest);
    await ensureApiRoles(src.pool);
    await ensureApiRoles(dest.pool);
    const srcPg = await openPostgresPool(src.uri);
    const destPg = await openPostgresPool(dest.uri);
    await srcPg.query(`
      CREATE EXTENSION pg_trgm SCHEMA public;
      CREATE TABLE public.t (id integer);
    `);
    await destPg.query(AUTO_EXPOSE_ADP);

    const exported = await buildSchemaExport(src.pool, {
      profile: supabaseProfile,
    });
    const names = exported.files.map((f) => f.name.replaceAll("\\", "/"));
    const wipeAt = names.findIndex((n) => n.endsWith("adp_wipes.sql"));
    const extAt = names.findIndex((n) => n.includes("/extensions/"));
    expect(wipeAt).toBeGreaterThanOrEqual(0);
    expect(extAt).toBeGreaterThanOrEqual(0);
    expect(wipeAt).toBeLessThan(extAt);

    await loadExport(exported.files, destPg);

    const overlayOnTrgm = async (pool: pg.Pool) => {
      const r = await pool.query<{ n: string }>(`
        SELECT count(*)::text AS n
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN LATERAL aclexplode(p.proacl) a ON p.proacl IS NOT NULL
        JOIN pg_roles g ON g.oid = a.grantee
        WHERE n.nspname = 'public'
          AND p.proname LIKE '%trgm%'
          AND g.rolname = 'anon'
      `);
      return Number(r.rows[0]?.n ?? 0);
    };
    expect(await overlayOnTrgm(srcPg)).toBe(0);
    expect(await overlayOnTrgm(destPg)).toBe(0);
  }, 180_000);

  test("alpine: ordered and grouped layouts wipe before identity seqs and trgm members", async () => {
    const cluster = await startStockCluster();
    extraClusters.push(cluster);
    const src = await cluster.createDb("priv_rt_layout_src");
    dbs.push(src);
    await ensureApiRoles(src.pool);
    const srcPg = await openPostgresPool(src.uri);
    await srcPg.query(`
      CREATE EXTENSION pg_trgm SCHEMA public;
      CREATE TABLE public.people (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        email text
      );
    `);

    const overlayCount = async (pool: pg.Pool) => {
      const r = await pool.query<{ seq_leak: number; fn_leak: number }>(`
        SELECT
          (SELECT count(*) FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           CROSS JOIN LATERAL aclexplode(c.relacl) a
           JOIN pg_roles g ON g.oid = a.grantee
           WHERE n.nspname = 'public' AND c.relname = 'people_id_seq'
             AND g.rolname IN ('anon', 'authenticated', 'service_role'))::int
            AS seq_leak,
          (SELECT count(*) FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
           CROSS JOIN LATERAL aclexplode(p.proacl) a
           JOIN pg_roles g ON g.oid = a.grantee
           WHERE n.nspname = 'public' AND p.proname LIKE '%trgm%'
             AND g.rolname IN ('anon', 'authenticated', 'service_role'))::int
            AS fn_leak
      `);
      return r.rows[0]!;
    };

    for (const layout of ["ordered", "grouped"] as const) {
      const dest = await cluster.createDb(`priv_rt_layout_${layout}`);
      dbs.push(dest);
      await ensureApiRoles(dest.pool);
      const destPg = await openPostgresPool(dest.uri);
      await destPg.query(AUTO_EXPOSE_ADP);
      const exported = await buildSchemaExport(src.pool, {
        profile: supabaseProfile,
        layout,
      });
      if (layout === "ordered") {
        const wipeAt = exported.files.findIndex((f) =>
          /ALTER DEFAULT PRIVILEGES[\s\S]*REVOKE ALL/.test(f.sql),
        );
        const extAt = exported.files.findIndex((f) =>
          /CREATE EXTENSION/.test(f.sql),
        );
        expect(wipeAt).toBeGreaterThanOrEqual(0);
        expect(extAt).toBeGreaterThanOrEqual(0);
        expect(wipeAt).toBeLessThan(extAt);
      } else {
        const names = exported.files.map((f) => f.name.replaceAll("\\", "/"));
        const wipeAt = names.findIndex((n) => n.endsWith("adp_wipes.sql"));
        const extAt = names.findIndex((n) => n.includes("/extensions/"));
        const tableAt = names.findIndex((n) => /\/tables\//.test(n));
        expect(wipeAt).toBeGreaterThanOrEqual(0);
        expect(extAt).toBeGreaterThanOrEqual(0);
        expect(tableAt).toBeGreaterThanOrEqual(0);
        expect(wipeAt).toBeLessThan(extAt);
        expect(wipeAt).toBeLessThan(tableAt);
      }
      await loadExport(exported.files, destPg);
      expect(await overlayCount(destPg)).toEqual({ seq_leak: 0, fn_leak: 0 });
    }
  }, 180_000);
});

describe.skipIf(!runSupabaseBareTests)(
  "export/load privilege round-trip (supabase image)",
  () => {
    test("re-granted auto-expose baseline preserves live ACLs; overlay covers pg_default_acl injectees", async () => {
      const cluster: Cluster = await supabaseCluster();
      const src = await cluster.createDb("priv_rt_sb_src");
      const dest = await cluster.createDb("priv_rt_sb_dest");
      dbs.push(src, dest);
      const srcPg = new pg.Pool({
        connectionString: src.postgresUri!,
        max: 3,
      });
      const destPg = new pg.Pool({
        connectionString: dest.postgresUri!,
        max: 3,
      });
      srcPg.on("error", () => {});
      destPg.on("error", () => {});
      extraPools.push(srcPg, destPg);
      await src.pool.query(
        `GRANT USAGE, CREATE ON SCHEMA public TO postgres, anon, authenticated, service_role`,
      );
      await dest.pool.query(
        `GRANT USAGE, CREATE ON SCHEMA public TO postgres, anon, authenticated, service_role`,
      );
      await srcPg.query(AUTO_EXPOSE_ADP);
      await srcPg.query(LIVE_SQL);
      await destPg.query(AUTO_EXPOSE_ADP);

      const overlay = flattenPolicy(supabasePolicy).assumedDefaultGrants;
      const overlayKeys = new Set(
        overlay.map(
          (g) =>
            `${g.creatingRole}\0${g.schema ?? ""}\0${g.objtype}\0${g.grantee}`,
        ),
      );
      const injectees = await destPg.query<{
        creating_role: string;
        schema: string;
        objtype: string;
        grantee: string;
      }>(`
        SELECT r.rolname AS creating_role,
               n.nspname AS schema,
               d.defaclobjtype::text AS objtype,
               COALESCE(g.rolname, 'PUBLIC') AS grantee
        FROM pg_catalog.pg_default_acl d
        JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
        JOIN pg_catalog.pg_roles r ON r.oid = d.defaclrole
        CROSS JOIN LATERAL aclexplode(d.defaclacl) a
        LEFT JOIN pg_catalog.pg_roles g ON g.oid = a.grantee
        WHERE r.rolname = 'postgres' AND n.nspname = 'public'
      `);
      for (const row of injectees.rows) {
        if (row.grantee === "PUBLIC" || row.grantee === row.creating_role)
          continue;
        const key = `${row.creating_role}\0${row.schema}\0${row.objtype}\0${row.grantee}`;
        expect(overlayKeys.has(key)).toBe(true);
      }

      const exported = await buildSchemaExport(src.pool, {
        profile: supabaseProfile,
      });
      expect(fileSql(exported.files, /get_account/)).toMatch(
        /REVOKE ALL ON FUNCTION "public"\."get_account"\(\) FROM PUBLIC, "anon"/,
      );
      await dest.pool.query(`ALTER SCHEMA public OWNER TO postgres`);
      await loadExport(exported.files, destPg);
      const destView = reconstructManagedView(
        (await extract(dest.pool)).factBase,
        {
          policy: supabasePolicy,
          scope: "database",
          defaultOwner: "postgres",
        },
      );
      const fnAcl = destView
        .facts()
        .filter((f) => {
          if (f.id.kind !== "acl") return false;
          const target = f.id.target;
          return target.kind === "function" && target.name === "get_account";
        })
        .map((f) => (f.id.kind === "acl" ? f.id.grantee : ""));
      expect(fnAcl).toContain("authenticated");
      expect(fnAcl).not.toContain("anon");
    }, 180_000);
  },
);
