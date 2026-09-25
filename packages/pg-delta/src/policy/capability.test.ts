/**
 * Applier-capability-restricted view (docs/architecture/managed-view-architecture.md move 6).
 *
 * The managed view is a function of (facts, policy, applier capability). An
 * operation the applier cannot execute is projected out — FDW ACLs (superuser
 * GRANT/REVOKE) and PG16+ CREATEROLE self-ADMIN memberships (0LP01). With no
 * capability (or a superuser), the view is unrestricted — the corpus path is
 * unchanged.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import { encodeId, type StableId } from "../core/stable-id.ts";
import { resolveView } from "./policy.ts";
import { plan } from "../plan/plan.ts";
import {
  CAPABILITY_CREATEROLE_SELF_ADMIN,
  CAPABILITY_FDW_ACL,
  capabilityExcludedRoots,
  type ApplierCapability,
} from "./capability.ts";

const f = (id: StableId): Fact => ({ id, payload: {} });
const fdw: StableId = { kind: "fdw", name: "w" };
const fdwAcl: StableId = { kind: "acl", target: fdw, grantee: "u" };
const tbl: StableId = { kind: "table", schema: "public", name: "t" };
const tblAcl: StableId = { kind: "acl", target: tbl, grantee: "u" };

const superuser: ApplierCapability = {
  role: "postgres",
  isSuperuser: true,
  memberOf: [],
};
const nonSuper: ApplierCapability = {
  role: "app",
  isSuperuser: false,
  memberOf: [],
};

describe("ApplierCapability — capability-restricted view (move 6)", () => {
  test("non-superuser → FDW ACL projected out of the view; table ACL kept", () => {
    const fb = buildFactBase([f(fdw), f(fdwAcl), f(tbl), f(tblAcl)], []);
    const view = resolveView(fb, undefined, nonSuper);
    expect(view.get(fdwAcl)).toBeUndefined(); // GRANT/REVOKE on FDW needs superuser
    expect(view.get(tblAcl)).toBeDefined(); // table ACLs are fine
    expect(view.get(fdw)).toBeDefined(); // the FDW object stays — only its ACL is unappliable
  });

  test("superuser → unrestricted view", () => {
    const fb = buildFactBase([f(fdw), f(fdwAcl)], []);
    expect(resolveView(fb, undefined, superuser).get(fdwAcl)).toBeDefined();
  });

  test("no capability → unrestricted view (corpus path)", () => {
    const fb = buildFactBase([f(fdw), f(fdwAcl)], []);
    expect(resolveView(fb, undefined, undefined).get(fdwAcl)).toBeDefined();
  });

  test("capabilityExcludedRoots: empty for superuser, the FDW ACL for non-superuser", () => {
    const fb = buildFactBase([f(fdw), f(fdwAcl), f(tbl), f(tblAcl)], []);
    expect(capabilityExcludedRoots(fb, superuser).size).toBe(0);
    const roots = capabilityExcludedRoots(fb, nonSuper);
    expect(roots.size).toBe(1);
    expect(roots.get(encodeId(fdwAcl))).toBe(CAPABILITY_FDW_ACL);
  });
});

describe("ApplierCapability — PG16+ CREATEROLE self-ADMIN membership", () => {
  const created: StableId = { kind: "role", name: "created" };
  const parent: StableId = { kind: "role", name: "parent" };
  const child: StableId = { kind: "role", name: "child" };
  const selfAdmin: StableId = {
    kind: "membership",
    role: "created",
    member: "app",
  };
  const peerGrant: StableId = {
    kind: "membership",
    role: "parent",
    member: "child",
  };
  const selfPlain: StableId = {
    kind: "membership",
    role: "created",
    member: "app",
  };
  const createrolePg16: ApplierCapability = {
    role: "app",
    isSuperuser: false,
    memberOf: [],
    createRole: true,
    pgMajor: 16,
  };
  const membershipFb = () =>
    buildFactBase(
      [
        f(created),
        f(parent),
        f(child),
        { id: selfAdmin, payload: { admin: true } },
        { id: peerGrant, payload: { admin: false } },
      ],
      [],
    );

  test("excludes admin self-membership for a PG16+ CREATEROLE non-superuser", () => {
    const fb = membershipFb();
    const roots = capabilityExcludedRoots(fb, createrolePg16);
    expect(roots.get(encodeId(selfAdmin))).toBe(
      CAPABILITY_CREATEROLE_SELF_ADMIN,
    );
    expect(roots.has(encodeId(peerGrant))).toBe(false);
    expect(
      resolveView(fb, undefined, createrolePg16).get(selfAdmin),
    ).toBeUndefined();
    expect(
      resolveView(fb, undefined, createrolePg16).get(peerGrant),
    ).toBeDefined();
  });

  test("keeps a non-admin self-membership", () => {
    const fb = buildFactBase(
      [f(created), { id: selfPlain, payload: { admin: false } }],
      [],
    );
    expect(capabilityExcludedRoots(fb, createrolePg16).size).toBe(0);
  });

  test("superuser, PG < 16, or omitted probe fields do not exclude", () => {
    const fb = membershipFb();
    expect(capabilityExcludedRoots(fb, superuser).size).toBe(0);
    expect(
      capabilityExcludedRoots(fb, {
        ...createrolePg16,
        pgMajor: 15,
      }).size,
    ).toBe(0);
    expect(
      capabilityExcludedRoots(fb, {
        role: "app",
        isSuperuser: false,
        memberOf: [],
      }).size,
    ).toBe(0);
    expect(
      capabilityExcludedRoots(fb, {
        ...createrolePg16,
        createRole: false,
      }).size,
    ).toBe(0);
  });
});

describe("ApplierCapability — owner residue fail-fast (follow-up 1)", () => {
  // owner can't be silently skipped (acldefault is owner-relative → no
  // convergence), so an owner action the applier can't run is a plan-time error.
  const schemaApp: StableId = { kind: "schema", name: "app" };
  const r1: StableId = { kind: "role", name: "r1" };
  const r2: StableId = { kind: "role", name: "r2" };
  const memberOfR1: ApplierCapability = {
    role: "app",
    isSuperuser: false,
    memberOf: ["r1"],
  };
  const ownerEdge = (to: StableId) =>
    ({ from: schemaApp, to, kind: "owner" }) as const;
  const desiredOwnedBy = (role: StableId) =>
    buildFactBase([f(schemaApp), f(role)], [ownerEdge(role)]);
  const source = (role: StableId) => buildFactBase([f(role)], []);

  test("plan throws when a non-superuser must set an owner it is not a member of", () => {
    expect(() =>
      plan(source(r2), desiredOwnedBy(r2), { capability: memberOfR1 }),
    ).toThrow(/cannot set owner/);
  });

  test("plan succeeds when the owner is a role the applier is a member of", () => {
    expect(() =>
      plan(source(r1), desiredOwnedBy(r1), { capability: memberOfR1 }),
    ).not.toThrow();
  });

  test("superuser can set any owner (no throw)", () => {
    expect(() =>
      plan(source(r2), desiredOwnedBy(r2), { capability: superuser }),
    ).not.toThrow();
  });

  test("no capability → no owner restriction (corpus path)", () => {
    expect(() => plan(source(r2), desiredOwnedBy(r2))).not.toThrow();
  });
});
