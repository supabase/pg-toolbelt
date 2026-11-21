/**
 * Applier authorization pass (revision 4): what a non-superuser applier's
 * plan gains over the superuser plan, per identity mode. The owner-lab
 * (tests/owner-lab) judges the results on real Postgres; these pin the shape.
 */
import { describe, expect, test } from "bun:test";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
} from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
import type { ApplierCapability } from "../../policy/capability.ts";
import { plan } from "../plan.ts";

const role = (name: string): Fact => ({
  id: { kind: "role", name },
  payload: {
    superuser: false,
    inherit: true,
    createRole: false,
    createDb: false,
    login: false,
    replication: false,
    bypassRls: false,
    config: [],
  },
});
const schema: StableId = { kind: "schema", name: "app" };
const table: StableId = { kind: "table", schema: "app", name: "t" };
const owned = (id: StableId, owner: string): DependencyEdge => ({
  from: id,
  to: { kind: "role", name: owner },
  kind: "owner",
});
const tableFact: Fact = {
  id: table,
  parent: schema,
  payload: { persistence: "p", rowSecurity: false, forceRowSecurity: false },
};
const state = (tableOwner: string, extra: Fact[] = []) =>
  buildFactBase(
    [
      role("app"),
      role("owner_a"),
      role("owner_b"),
      { id: schema, payload: {} },
      tableFact,
      ...extra,
    ],
    [owned(schema, "app"), owned(table, tableOwner)],
  );
// a PG17 CREATEROLE applier that created owner_a / owner_b (direct ADMIN)
// but holds neither
const applier: ApplierCapability = {
  role: "app",
  isSuperuser: false,
  memberOf: [],
  createRole: true,
  pgMajor: 17,
  inherit: true,
  settableRoles: [],
  usableRoles: [],
  inheritedRoles: [],
  adminOf: ["owner_a", "owner_b"],
  selfGrants: [],
  reservedMemberships: [],
};
const sqlOf = (p: ReturnType<typeof plan>) =>
  p.actions.map((a) => (a.runAs ? `[as ${a.runAs}] ${a.sql}` : a.sql));

describe("applier authorization", () => {
  test("superuser and capability-free plans are untouched", () => {
    const bare = plan(state("owner_a"), state("owner_b"));
    const su = plan(state("owner_a"), state("owner_b"), {
      capability: { ...applier, isSuperuser: true },
    });
    expect(su.actions).toEqual(bare.actions);
    expect(su.boundApplier).toBeUndefined();
  });

  test("union: the envelope opens both owners with INHERIT and SET around the plan", () => {
    const p = plan(state("owner_a"), state("owner_b"), {
      capability: applier,
      ownerMode: "union",
    });
    expect(p.blockers).toBeUndefined();
    expect(p.boundApplier).toBe("app");
    const bare = sqlOf(plan(state("owner_a"), state("owner_b")));
    const at = bare.indexOf('ALTER TABLE "app"."t" OWNER TO "owner_b"');
    expect(sqlOf(p)).toEqual([
      'GRANT "owner_a" TO "app" WITH INHERIT TRUE, SET TRUE GRANTED BY "app"',
      'GRANT "owner_b" TO "app" WITH INHERIT TRUE, SET TRUE GRANTED BY "app"',
      ...bare.slice(0, at),
      // the new owner gets CREATE on the schema for the owner change only
      'GRANT CREATE ON SCHEMA "app" TO "owner_b"',
      bare[at] as string,
      'REVOKE CREATE ON SCHEMA "app" FROM "owner_b"',
      ...bare.slice(at + 1),
      'REVOKE "owner_a" FROM "app" GRANTED BY "app"',
      'REVOKE "owner_b" FROM "app" GRANTED BY "app"',
    ]);
  });

  test("an ACL statement runs as the owner when another inherited role holds a grant option", () => {
    const acl = (grantee: string, grantable: string[]): Fact => ({
      id: { kind: "acl", target: table, grantee },
      parent: table,
      payload: { privileges: ["SELECT"], grantable },
    });
    const withGrants = (extra: Fact[]) => state("owner_a", extra);
    const p = plan(
      withGrants([acl("owner_b", ["SELECT"])]),
      withGrants([acl("owner_b", ["SELECT"]), acl("app", [])]),
      // owner_b, whom the applier inherits, holds a grant option
      {
        capability: { ...applier, inheritedRoles: ["owner_b"] },
        ownerMode: "union",
      },
    );
    expect(
      sqlOf(p).filter((s) => s.includes('TO "app"') && s.startsWith("[as")),
    ).toEqual(['[as owner_a] GRANT SELECT ON TABLE "app"."t" TO "app"']);
  });

  test("a new owner the applier can neither set nor grant itself is a blocker", () => {
    const p = plan(state("owner_a"), state("owner_b"), {
      capability: { ...applier, adminOf: ["owner_a"] },
    });
    expect(p.blockers?.map((b) => [b.code, b.role])).toEqual([
      ["capability_owner", "owner_b"],
    ]);
  });
});
