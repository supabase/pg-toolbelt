/**
 * probeApplierCapability against a real connection (managed-view move 6).
 * The capability-restricted view's projection logic is unit-tested
 * (src/policy/capability.test.ts); this proves the probe query runs and reports
 * the connection's role / superuser / memberships. Docker required.
 */
import { describe, expect, test } from "bun:test";
import pg from "pg";
import { probeApplierCapability } from "../src/policy/capability.ts";
import { sharedCluster } from "./containers.ts";

describe("probeApplierCapability (integration)", () => {
  test("reports the connection's role, superuser flag, and memberships", async () => {
    const cluster = await sharedCluster();
    const cap = await probeApplierCapability(cluster.adminPool);
    // the container admin is a superuser
    expect(cap.role.length).toBeGreaterThan(0);
    expect(cap.isSuperuser).toBe(true);
    expect(typeof cap.createRole).toBe("boolean");
    expect(cap.pgMajor).toBeGreaterThanOrEqual(14);
    // memberOf is a real parsed string[] (a role is a member of itself) — guards
    // against the pg driver returning the array as an unparsed "{...}" literal.
    expect(Array.isArray(cap.memberOf)).toBe(true);
    expect(cap.memberOf).toContain(cap.role);
  }, 60_000);

  test("a CREATEROLE creator can SET only roles it is granted and reports the roles it can grant", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("cap_creator_probe");
    await cluster.adminPool
      .query(`CREATE ROLE cap_creator LOGIN PASSWORD 'pw' CREATEROLE`)
      .catch(() => {});
    const pool = new pg.Pool({
      connectionString: db.uri.replace("test:test@", "cap_creator:pw@"),
      max: 1,
    });
    pool.on("error", () => {});
    try {
      await pool.query(`DROP ROLE IF EXISTS cap_made`);
      await pool.query(`CREATE ROLE cap_made NOLOGIN`);
      const cap = await probeApplierCapability(pool);
      // PG16+ records an ADMIN-only grant (no SET) for the creator; ALTER …
      // OWNER TO needs SET, so the role must not count as settable.
      expect(cap.memberOf).not.toContain("cap_made");
      // grantable: ADMIN OPTION on PG16+, any non-superuser role before
      expect(cap.adminOf).toContain("cap_made");
      expect(cap.adminOf).not.toContain("test");
      expect(cap.createroleSelfGrant).toBe(
        (cap.pgMajor ?? 0) >= 16 ? "" : undefined,
      );
    } finally {
      await pool.query(`DROP ROLE IF EXISTS cap_made`).catch(() => {});
      await pool.end().catch(() => {});
      await db.drop();
    }
  }, 60_000);

  // The capability FDW-ACL gate is keyed on isSuperuser. This pins the rule it
  // rests on (Supabase Rule 9's stated rationale): a non-superuser cannot GRANT
  // on a FOREIGN DATA WRAPPER, so its ACL is not user-replayable.
  test("VERIFY: a non-superuser cannot GRANT on a FOREIGN DATA WRAPPER", async () => {
    const cluster = await sharedCluster();
    const db = await cluster.createDb("cap_fdw_verify");
    try {
      await db.pool.query(`CREATE EXTENSION IF NOT EXISTS postgres_fdw`);
      await cluster.adminPool
        .query(`CREATE ROLE cap_nonsuper LOGIN PASSWORD 'pw'`)
        .catch(() => {});

      const capUri = db.uri.replace("test:test@", "cap_nonsuper:pw@");
      const capPool = new pg.Pool({ connectionString: capUri, max: 1 });
      capPool.on("error", () => {});
      try {
        const cap = await probeApplierCapability(capPool);
        expect(cap.isSuperuser).toBe(false); // a plain LOGIN role is not super

        let grantError: string | undefined;
        try {
          await capPool.query(
            `GRANT USAGE ON FOREIGN DATA WRAPPER postgres_fdw TO PUBLIC`,
          );
        } catch (e) {
          grantError = String(e);
        }
        // the GRANT must be rejected — confirming the isSuperuser gate
        expect(grantError).toBeDefined();
      } finally {
        await capPool.end().catch(() => {});
      }
    } finally {
      await db.drop();
      await cluster.adminPool
        .query(`DROP ROLE IF EXISTS cap_nonsuper`)
        .catch(() => {});
    }
  }, 60_000);
});
