/**
 * Owner-as-edge integration tests (managed-view-architecture move 2).
 *
 * Object ownership is now an `owner` EDGE (object --owner--> role), not a
 * payload field. The planner emits `ALTER <KIND> OWNER TO` from owner-edge
 * link deltas; an out-of-view owner role prunes the edge → the object is
 * created ownerless — no skipAuthorization param needed.
 *
 * Docker required.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../src/core/fact.ts";
import type { StableId } from "../src/core/stable-id.ts";
import { extract } from "../src/extract/extract.ts";
import { plan } from "../src/plan/plan.ts";
import { provePlan } from "../src/proof/prove.ts";
import type { Policy } from "../src/policy/policy.ts";
import type { ApplierCapability } from "../src/policy/capability.ts";
import {
  isolatedClusterPair,
  sharedCluster,
  type TestDb,
} from "./containers.ts";

const dbs: TestDb[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((d) => d.drop().catch(() => {})));
});

// ---------------------------------------------------------------------------
// Test (a): owner roundtrip — the owner edge is emitted and the plan applies
// ---------------------------------------------------------------------------

describe("owner edge: owner roundtrip proves clean", () => {
  test("schema + table owned by role r → plan(empty, desired) → provePlan → ok, zero drift", async () => {
    const [clusterA, clusterB] = await isolatedClusterPair();

    const srcDb = await clusterA.createDb("ownedge_rtrip_src");
    const dstDb = await clusterB.createDb("ownedge_rtrip_dst");
    dbs.push(srcDb, dstDb);

    // Role r exists on BOTH clusters (source clone needs it to be the owner)
    await clusterA.adminPool
      .query(`CREATE ROLE ownedge_r NOLOGIN`)
      .catch(() => {});
    await clusterB.adminPool
      .query(`CREATE ROLE ownedge_r NOLOGIN`)
      .catch(() => {});

    // Desired: schema s owned by ownedge_r, table s.t owned by ownedge_r
    await dstDb.pool.query(`
        CREATE SCHEMA s AUTHORIZATION ownedge_r;
        CREATE TABLE s.t (id int);
        ALTER TABLE s.t OWNER TO ownedge_r;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);

    const thePlan = plan(srcState.factBase, dstState.factBase);

    // Should produce ALTER ... OWNER TO actions
    const ownerActions = thePlan.actions.filter((a) =>
      a.sql.includes("OWNER TO"),
    );
    expect(ownerActions.length).toBeGreaterThan(0);

    // provePlan against a clone of the source cluster A (which has the role)
    const clone = await srcDb.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (b): owner change — unlink old owner + link new owner → ALTER OWNER TO
// ---------------------------------------------------------------------------

describe("owner edge: owner change emits ALTER OWNER TO", () => {
  test("s.t owned by r1 in source, owned by r2 in desired → ALTER TABLE s.t OWNER TO r2", async () => {
    const cluster = await sharedCluster();
    const srcDb = await cluster.createDb("ownedge_chg_src");
    const dstDb = await cluster.createDb("ownedge_chg_dst");
    dbs.push(srcDb, dstDb);

    // Create both roles in the shared cluster
    await cluster.adminPool
      .query(`CREATE ROLE ownedge_r1 NOLOGIN`)
      .catch(() => {});
    await cluster.adminPool
      .query(`CREATE ROLE ownedge_r2 NOLOGIN`)
      .catch(() => {});

    // Source: schema s + table owned by r1
    await srcDb.pool.query(`
        CREATE SCHEMA s AUTHORIZATION ownedge_r1;
        CREATE TABLE s.t (id int);
        ALTER TABLE s.t OWNER TO ownedge_r1;
      `);

    // Desired: same schema s + table, but owned by r2
    await dstDb.pool.query(`
        CREATE SCHEMA s AUTHORIZATION ownedge_r2;
        CREATE TABLE s.t (id int);
        ALTER TABLE s.t OWNER TO ownedge_r2;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(srcDb.pool),
      extract(dstDb.pool),
    ]);

    const thePlan = plan(srcState.factBase, dstState.factBase);

    // Should contain an `ALTER … OWNER TO ownedge_r2` action (identifiers are
    // quoted, e.g. ALTER TABLE "s"."t" OWNER TO "ownedge_r2" — match on the new
    // owner, not an unquoted "s.t").
    const ownerToR2 = thePlan.actions.filter(
      (a) => a.sql.includes("OWNER TO") && a.sql.includes("ownedge_r2"),
    );
    expect(ownerToR2.length).toBeGreaterThan(0);

    // provePlan on clone of src
    const clone = await srcDb.clone();
    dbs.push(clone);
    const verdict = await provePlan(thePlan, clone.pool, dstState.factBase);
    expect(verdict.applyError).toBeUndefined();
    expect(verdict.driftDeltas).toEqual([]);
    expect(verdict.ok).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Test (c): system-role owner projection (skipAuthorization elimination)
// Unit-level: synthetic fact base, no Docker needed for the core assertion.
// ---------------------------------------------------------------------------

describe("owner edge: out-of-view owner role prunes ownership (skipAuth elimination)", () => {
  test("schema app with owner edge to role sys (excluded by policy) → CREATE SCHEMA app, NO ALTER OWNER TO", () => {
    const f = (id: StableId, parent?: StableId): Fact =>
      parent ? { id, parent, payload: {} } : { id, payload: {} };

    const schemaId: StableId = { kind: "schema", name: "app" };
    const roleId: StableId = { kind: "role", name: "sys" };

    // Source: empty
    const source = buildFactBase([], []);

    // Desired: schema app + role sys + owner edge
    const desired = buildFactBase(
      [f(schemaId), f(roleId)],
      [{ from: schemaId, to: roleId, kind: "owner" }],
    );

    // Policy: exclude the sys role (by kind+name)
    const excludeSysRole: Policy = {
      id: "test-skipauth",
      filter: [
        {
          match: { all: [{ kind: "role" }, { name: "sys" }] },
          action: "exclude",
        },
      ],
    };

    // plan() should NOT throw (owner edge is pruned with its endpoint)
    const thePlan = plan(source, desired, { policy: excludeSysRole });

    // There must be a CREATE SCHEMA app action
    const createSchema = thePlan.actions.find(
      (a) =>
        a.verb === "create" &&
        a.produces.some(
          (id) =>
            id.kind === "schema" && (id as { name: string }).name === "app",
        ),
    );
    expect(createSchema).toBeDefined();

    // There must be NO ALTER SCHEMA OWNER TO action
    const ownerAction = thePlan.actions.find((a) => a.sql.includes("OWNER TO"));
    expect(ownerAction).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test (d): owner residue (follow-up 1). A non-superuser applier that is not a
// member of an object's owner role cannot run ALTER … OWNER TO. The owner can't
// be silently skipped (acldefault is owner-relative → no convergence), so the
// planner FAILS FAST with an actionable error, surfaced before any apply.
// ---------------------------------------------------------------------------

describe("owner edge: owner residue — applier can't set owner → fail fast", () => {
  test("a non-superuser capability rejects a plan that must set an unsettable owner", async () => {
    const cluster = await sharedCluster();
    const src = await cluster.createDb("cap_owner_src");
    const dst = await cluster.createDb("cap_owner_dst");
    dbs.push(src, dst);
    await cluster.adminPool
      .query(`CREATE ROLE cap_other_owner NOLOGIN`)
      .catch(() => {});
    // desired: a schema + table owned by cap_other_owner
    await dst.pool.query(`
        CREATE SCHEMA caps AUTHORIZATION cap_other_owner;
        CREATE TABLE caps.t (id int);
        ALTER TABLE caps.t OWNER TO cap_other_owner;
      `);

    const [srcState, dstState] = await Promise.all([
      extract(src.pool),
      extract(dst.pool),
    ]);

    // an applier that is a member of NO role (so it cannot set owner to
    // cap_other_owner). isSuperuser:false forces the capability check.
    const capability: ApplierCapability = {
      role: "applier",
      isSuperuser: false,
      memberOf: new Set(),
    };

    expect(() =>
      plan(srcState.factBase, dstState.factBase, { capability }),
    ).toThrow(/cannot set owner/);

    // a superuser applier (or none) plans fine — the objects + owner ALTERs land
    expect(() => plan(srcState.factBase, dstState.factBase)).not.toThrow();
  }, 120_000);
});
