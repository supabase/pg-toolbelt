/**
 * CLI-2341: a platform event trigger owned by `postgres` on one side and
 * `supabase_admin` on the other must not become a create/drop. Rule 6 is
 * owner-based and per-side, so the `postgres`-owned copy stays managed and
 * the planner emits CREATE of a trigger that already exists. Exclude the
 * platform name set (`issue_*` / `pgrst_*` / `graphql_watch_*`) by identity.
 * Pure policy level — no DB.
 */
import { describe, expect, test } from "bun:test";
import { buildFactBase, type Fact } from "../core/fact.ts";
import type { StableId } from "../core/stable-id.ts";
import { plan } from "../plan/plan.ts";
import { resolveView } from "./policy.ts";
import { supabasePolicy } from "./supabase.ts";

const postgres: StableId = { kind: "role", name: "postgres" };
const admin: StableId = { kind: "role", name: "supabase_admin" };
const issueEt: StableId = {
  kind: "eventTrigger",
  name: "issue_pg_graphql_access",
};
const pgrstEt: StableId = { kind: "eventTrigger", name: "pgrst_drop_watch" };
const gqlEt: StableId = { kind: "eventTrigger", name: "graphql_watch_ddl" };
const userEt: StableId = { kind: "eventTrigger", name: "my_ddl_logger" };

function role(id: StableId, superuser: boolean): Fact {
  return { id, payload: { superuser } };
}

function et(id: StableId): Fact {
  return {
    id,
    payload: {
      event: "ddl_command_end",
      enabled: "O",
      tags: ["CREATE FUNCTION"],
      functionSchema: "extensions",
      functionName: "grant_pg_graphql_access",
    },
  };
}

function world(owner: StableId) {
  return buildFactBase(
    [
      role(postgres, false),
      role(admin, true),
      et(issueEt),
      et(pgrstEt),
      et(gqlEt),
      et(userEt),
    ],
    [
      { from: issueEt, to: owner, kind: "owner" },
      { from: pgrstEt, to: owner, kind: "owner" },
      { from: gqlEt, to: owner, kind: "owner" },
      { from: userEt, to: postgres, kind: "owner" },
    ],
  );
}

describe("supabase policy — platform event triggers (CLI-2341)", () => {
  test("excludes issue_*/pgrst_*/graphql_watch_* even when owned by postgres", () => {
    const view = resolveView(world(postgres), supabasePolicy);
    expect(view.get(issueEt)).toBeUndefined();
    expect(view.get(pgrstEt)).toBeUndefined();
    expect(view.get(gqlEt)).toBeUndefined();
    expect(view.get(userEt)).toBeDefined();
  });

  test("still excludes the same names when owned by supabase_admin (Rule 6)", () => {
    const view = resolveView(world(admin), supabasePolicy);
    expect(view.get(issueEt)).toBeUndefined();
    expect(view.get(userEt)).toBeDefined();
  });

  test("owner-asymmetric platform trigger does not plan CREATE or DROP", () => {
    const sql = plan(world(admin), world(postgres), { policy: supabasePolicy })
      .actions.map((a) => a.sql)
      .join("\n");
    expect(sql).not.toMatch(/CREATE EVENT TRIGGER "issue_pg_graphql_access"/);
    expect(sql).not.toMatch(/DROP EVENT TRIGGER "issue_pg_graphql_access"/);
    expect(sql).not.toMatch(/CREATE EVENT TRIGGER "pgrst_drop_watch"/);
    expect(sql).not.toMatch(/CREATE EVENT TRIGGER "graphql_watch_ddl"/);
  });
});
