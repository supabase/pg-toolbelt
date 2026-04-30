import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { stableId } from "../../utils.ts";
import { RlsPolicy } from "../rls-policy.model.ts";
import { CreateRlsPolicy } from "./rls-policy.create.ts";

describe("rls-policy", () => {
  test("create minimal", async () => {
    const policy = new RlsPolicy({
      schema: "public",
      name: "test_policy_min",
      table_name: "test_table",
      command: "*",
      permissive: true,
      roles: [],
      using_expression: null,
      with_check_expression: null,
      owner: "test",
      comment: null,
      referenced_relations: [],
      referenced_procedures: [],
    });

    const change = new CreateRlsPolicy({
      policy,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE POLICY test_policy_min ON public.test_table",
    );
  });

  test("create", async () => {
    const policy = new RlsPolicy({
      schema: "public",
      name: "test_policy",
      table_name: "test_table",
      command: "r",
      permissive: true,
      roles: ["public"],
      using_expression: "user_id = current_user_id()",
      with_check_expression: null,
      owner: "test",
      comment: null,
      referenced_relations: [],
      referenced_procedures: [],
    });

    const change = new CreateRlsPolicy({
      policy,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE POLICY test_policy ON public.test_table FOR SELECT USING (user_id = current_user_id())",
    );
  });

  test("create with all options", async () => {
    const policy = new RlsPolicy({
      schema: "public",
      name: "test_policy_all",
      table_name: "test_table",
      command: "w",
      permissive: false,
      roles: ["role1", "role2"],
      using_expression: "expr1",
      with_check_expression: "expr2",
      owner: "test",
      comment: null,
      referenced_relations: [],
      referenced_procedures: [],
    });

    const change = new CreateRlsPolicy({
      policy,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE POLICY test_policy_all ON public.test_table AS RESTRICTIVE FOR UPDATE TO role1, role2 USING (expr1) WITH CHECK (expr2)",
    );
  });

  test("requires referenced relations reported by pg_depend", () => {
    const policy = new RlsPolicy({
      schema: "app",
      name: "cross_relation_policy",
      table_name: "accounts",
      command: "r",
      permissive: true,
      roles: ["public"],
      using_expression:
        "(EXISTS (SELECT 1 FROM app.users) AND EXISTS (SELECT 1 FROM app.active_accounts))",
      with_check_expression:
        "(id IN (SELECT account_id FROM app.memberships WHERE active))",
      owner: "test",
      comment: null,
      referenced_relations: [
        { kind: "table", schema: "app", name: "users" },
        { kind: "table", schema: "app", name: "memberships" },
        { kind: "view", schema: "app", name: "active_accounts" },
        { kind: "materialized_view", schema: "app", name: "account_stats" },
        { kind: "foreign_table", schema: "app", name: "remote_profiles" },
      ],
      referenced_procedures: [],
    });

    const change = new CreateRlsPolicy({ policy });

    expect(change.requires).toContain(stableId.table("app", "users"));
    expect(change.requires).toContain(stableId.table("app", "memberships"));
    expect(change.requires).toContain(stableId.view("app", "active_accounts"));
    expect(change.requires).toContain(
      stableId.materializedView("app", "account_stats"),
    );
    expect(change.requires).toContain(
      stableId.foreignTable("app", "remote_profiles"),
    );
  });

  test("requires referenced procedures reported by pg_depend", () => {
    const policy = new RlsPolicy({
      schema: "app",
      name: "function_guarded_policy",
      table_name: "accounts",
      command: "r",
      permissive: true,
      roles: ["public"],
      using_expression: "public.is_admin()",
      with_check_expression: null,
      owner: "test",
      comment: null,
      referenced_relations: [],
      referenced_procedures: [
        { schema: "public", name: "is_admin", argument_types: [] },
        {
          schema: "public",
          name: "has_role",
          argument_types: ["text", "integer"],
        },
      ],
    });

    const change = new CreateRlsPolicy({ policy });

    expect(change.requires).toContain(stableId.procedure("public", "is_admin"));
    expect(change.requires).toContain(
      stableId.procedure("public", "has_role", "text,integer"),
    );
  });

  test("does not require additional objects when referenced lists are empty", () => {
    const policy = new RlsPolicy({
      schema: "app",
      name: "simple_policy",
      table_name: "accounts",
      command: "*",
      permissive: true,
      roles: [],
      using_expression: null,
      with_check_expression: null,
      owner: "test",
      comment: null,
      referenced_relations: [],
      referenced_procedures: [],
    });

    const change = new CreateRlsPolicy({ policy });

    expect(change.requires).toEqual([
      stableId.schema("app"),
      stableId.table("app", "accounts"),
      stableId.role("test"),
    ]);
  });

  // Sequences referenced via nextval() are a known gap. pg_depend only
  // records the sequence edge when the argument is written as a regclass
  // literal (e.g. `nextval('app.seq'::regclass)`); bare string literals
  // produce no pg_depend row. Tracked in
  // https://github.com/supabase/pg-toolbelt/issues/220.
  test.skip("requires referenced sequences (follow-up)", () => {
    const policy = new RlsPolicy({
      schema: "app",
      name: "sequence_policy",
      table_name: "accounts",
      command: "r",
      permissive: true,
      roles: ["public"],
      using_expression: "id < nextval('app.next_id'::regclass)",
      with_check_expression: null,
      owner: "test",
      comment: null,
      referenced_relations: [],
      referenced_procedures: [],
    });

    const change = new CreateRlsPolicy({ policy });

    // Expected once the gap is closed:
    //   expect(change.requires).toContain(stableId.sequence("app", "next_id"));
    expect(change.requires.length).toBeGreaterThan(0);
  });
});
