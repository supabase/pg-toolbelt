/**
 * Applier-capability-restricted view (docs/architecture/managed-view-architecture.md move 6).
 *
 * The managed view is a function of (facts, policy, applier capability). An
 * operation the applier cannot execute is projected out — currently FDW ACLs
 * (superuser GRANT/REVOKE) and event triggers whose function is superuser-owned
 * (supautils T_CreateEventTrigStmt / PostgreSQL: a non-superuser cannot own an
 * event trigger on a superuser-owned function). Additive: Supabase Rule 9 still
 * stands for FDW ACLs. With no capability (or a superuser), the view is
 * unrestricted — the corpus path is unchanged.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { resolveView } from "./policy.ts";
import { plan } from "../plan/plan.ts";
import {
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
  });
});

describe("ApplierCapability — event trigger on a superuser-owned function", () => {
  // supautils (and PostgreSQL without it): a non-superuser may create an event
  // trigger only if its function is not superuser-owned. Expressed on facts:
  // the function's owner edge → role.payload.superuser.
  const suRole: StableId = { kind: "role", name: "su" };
  const appRole: StableId = { kind: "role", name: "app" };
  const suFn: StableId = {
    kind: "function",
    schema: "public",
    name: "on_ddl",
    args: [],
  };
  const appFn: StableId = {
    kind: "function",
    schema: "public",
    name: "user_fn",
    args: [],
  };
  const suEt: StableId = { kind: "eventTrigger", name: "on_ddl_end" };
  const appEt: StableId = { kind: "eventTrigger", name: "user_et" };

  const role = (id: StableId, isSuper: boolean): Fact => ({
    id,
    payload: { superuser: isSuper },
  });
  const et = (id: StableId, fn: StableId): Fact => ({
    id,
    payload: {
      event: "ddl_command_end",
      enabled: "O",
      tags: [],
      functionSchema: (fn as { schema: string }).schema,
      functionName: (fn as { name: string }).name,
    },
  });

  const fb = buildFactBase(
    [
      role(suRole, true),
      role(appRole, false),
      f(suFn),
      f(appFn),
      et(suEt, suFn),
      et(appEt, appFn),
    ],
    [
      { from: suFn, to: suRole, kind: "owner" },
      { from: appFn, to: appRole, kind: "owner" },
    ],
  );

  test("non-superuser projects out an event trigger whose function is superuser-owned", () => {
    const view = resolveView(fb, undefined, nonSuper);
    expect(view.get(suEt)).toBeUndefined();
    expect(view.get(appEt)).toBeDefined();
    expect(view.get(suFn)).toBeDefined();
  });

  test("superuser and no-capability keep the event trigger (corpus path)", () => {
    expect(resolveView(fb, undefined, superuser).get(suEt)).toBeDefined();
    expect(resolveView(fb, undefined, undefined).get(suEt)).toBeDefined();
  });

  test("baseline-identical function/role still project the event trigger out", () => {
    // subtractBaseline drops unchanged function + superuser role before
    // capability runs; the lookup must still see them on the raw catalog.
    const baseline = buildFactBase(
      [role(suRole, true), f(suFn)],
      [{ from: suFn, to: suRole, kind: "owner" }],
    );
    const view = resolveView(fb, undefined, nonSuper, baseline);
    expect(view.get(suEt)).toBeUndefined();
    expect(view.get(appEt)).toBeDefined();
  });

  test("non-superuser plan omits CREATE EVENT TRIGGER for the superuser-backed trigger", () => {
    // Functions already present on both sides so the only deltas are the ETs.
    const source = buildFactBase(
      [role(suRole, true), role(appRole, false), f(suFn), f(appFn)],
      [
        { from: suFn, to: suRole, kind: "owner" },
        { from: appFn, to: appRole, kind: "owner" },
      ],
    );
    const sql = plan(source, fb, { capability: nonSuper })
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).not.toMatch(/CREATE EVENT TRIGGER "on_ddl_end"/);
    expect(sql).toMatch(/CREATE EVENT TRIGGER "user_et"/);
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
