/**
 * An object that moves from a custom owner back to the default owner has no
 * owner edge in the projected desired view (the dangling edge to the default
 * owner is pruned), so only an owner `unlink` delta reaches the emitter.
 */
import { describe, expect, test } from "bun:test";
import {
  buildFactBase,
  type DependencyEdge,
  type Fact,
} from "../../core/fact.ts";
import type { StableId } from "../../core/stable-id.ts";
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
const facts = (extraRoles: Fact[]): Fact[] => [
  ...extraRoles,
  { id: schema, payload: {} },
  {
    id: table,
    parent: schema,
    payload: { persistence: "p", rowSecurity: false, forceRowSecurity: false },
  },
];
const ownerSql = (p: ReturnType<typeof plan>) =>
  p.actions.map((a) => a.sql).filter((s) => s.includes("OWNER TO"));

describe("owner change back to the default owner", () => {
  test("custom owner -> defaultOwner emits exactly one OWNER TO", () => {
    const roles = [role("r"), role("postgres")];
    const source = buildFactBase(facts(roles), [
      owned(schema, "postgres"),
      owned(table, "r"),
    ]);
    const desired = buildFactBase(facts(roles), [
      owned(schema, "postgres"),
      owned(table, "postgres"),
    ]);
    // database scope removes the role facts and prunes the edge to the
    // default owner, leaving the desired table without an owner edge
    const p = plan(source, desired, {
      defaultOwner: "postgres",
      scope: "database",
    });
    expect(ownerSql(p)).toEqual(['ALTER TABLE "app"."t" OWNER TO "postgres"']);
  });

  test("custom owner -> the policy's default owner emits exactly one OWNER TO", () => {
    const roles = [role("r"), role("postgres")];
    const source = buildFactBase(facts(roles), [
      owned(schema, "postgres"),
      owned(table, "r"),
    ]);
    const desired = buildFactBase(facts(roles), [
      owned(schema, "postgres"),
      owned(table, "postgres"),
    ]);
    // no run-level defaultOwner: the policy declares it, and its filter drops
    // the role (as the Supabase profile does), pruning the owner edge to it
    const p = plan(source, desired, {
      policy: {
        id: "default-owner-policy",
        defaultOwner: "postgres",
        filter: [
          {
            match: { all: [{ kind: "role" }, { name: "postgres" }] },
            action: "exclude",
          },
        ],
      },
    });
    expect(ownerSql(p)).toEqual(['ALTER TABLE "app"."t" OWNER TO "postgres"']);
  });

  test("custom owner -> out-of-view non-default owner emits nothing", () => {
    const source = buildFactBase(facts([role("r"), role("postgres")]), [
      owned(schema, "postgres"),
      owned(table, "r"),
    ]);
    const desired = buildFactBase(
      facts([role("r"), role("postgres"), role("other")]),
      [owned(schema, "postgres"), owned(table, "other")],
    );
    // the policy drops role "other" and its owner edge with it
    const p = plan(source, desired, {
      defaultOwner: "postgres",
      policy: {
        id: "exclude-other",
        filter: [
          {
            match: { all: [{ kind: "role" }, { name: "other" }] },
            action: "exclude",
          },
        ],
      },
    });
    expect(ownerSql(p)).toEqual([]);
  });
});
