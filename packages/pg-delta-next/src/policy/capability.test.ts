/**
 * Applier-capability-restricted view (docs/managed-view-architecture.md move 6).
 *
 * The managed view is a function of (facts, policy, applier capability). An
 * operation the applier cannot execute is projected out — currently FDW ACLs,
 * which require superuser to GRANT/REVOKE. This is additive: the Supabase
 * Rule 9 (`{ acl, target fdw } → exclude`) still stands; capability derives the
 * same exclusion for ANY non-superuser applier. With no capability (or a
 * superuser), the view is unrestricted — the corpus path is unchanged.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { resolveView } from "./policy.ts";
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
  memberOf: new Set(),
};
const nonSuper: ApplierCapability = {
  role: "app",
  isSuperuser: false,
  memberOf: new Set(),
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
