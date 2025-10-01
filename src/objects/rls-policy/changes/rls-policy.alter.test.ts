import { describe, expect, test } from "vitest";
import { diffRlsPolicies } from "../rls-policy.diff.ts";
import { RlsPolicy, type RlsPolicyProps } from "../rls-policy.model.ts";
import {
  AlterRlsPolicySetRoles,
  AlterRlsPolicySetUsingExpression,
  AlterRlsPolicySetWithCheckExpression,
} from "./rls-policy.alter.ts";
import { CreateRlsPolicy } from "./rls-policy.create.ts";
import { DropRlsPolicy } from "./rls-policy.drop.ts";

describe.concurrent("rls-policy", () => {
  describe("alter", () => {
    test("change roles", () => {
      const props: Omit<RlsPolicyProps, "roles"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
        owner: "owner",
        comment: null,
      };
      const policy = new RlsPolicy({
        ...props,
        roles: ["public"],
      });

      const change = new AlterRlsPolicySetRoles({
        policy,
        roles: ["role1", "role2"],
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table TO role1, role2",
      );
    });

    test("change roles to PUBLIC (default)", () => {
      const props: Omit<RlsPolicyProps, "roles"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        using_expression: "expr",
        with_check_expression: null,
        owner: "owner",
        comment: null,
      };
      const policy = new RlsPolicy({
        ...props,
        roles: ["role1"],
      });

      const change = new AlterRlsPolicySetRoles({
        policy,
        roles: ["public"],
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table TO PUBLIC",
      );
    });

    test("drop + create rls policy when command changes", () => {
      const props: Omit<RlsPolicyProps, "command"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        permissive: true,
        roles: ["public"],
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
        owner: "owner",
        comment: null,
      };
      const main = new RlsPolicy({
        ...props,
        command: "r", // SELECT
      });
      const branch = new RlsPolicy({
        ...props,
        command: "w", // UPDATE
      });

      const changes = diffRlsPolicies(
        { [main.stableId]: main },
        { [branch.stableId]: branch },
      );

      expect(changes).toHaveLength(2);
      expect(changes[0]).toBeInstanceOf(DropRlsPolicy);
      expect(changes[1]).toBeInstanceOf(CreateRlsPolicy);
      expect(changes[0].serialize()).toBe(
        "DROP POLICY test_policy ON public.test_table",
      );
      expect(changes[1].serialize()).toBe(
        "CREATE POLICY test_policy ON public.test_table FOR UPDATE USING (user_id = current_user_id())",
      );
    });

    test("drop + create rls policy when permissive changes", () => {
      const props: Omit<RlsPolicyProps, "permissive"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        roles: ["public"],
        using_expression: "user_id = current_user_id()",
        with_check_expression: null,
        owner: "owner",
        comment: null,
      };
      const main = new RlsPolicy({
        ...props,
        permissive: true,
      });
      const branch = new RlsPolicy({
        ...props,
        permissive: false,
      });

      const changes = diffRlsPolicies(
        { [main.stableId]: main },
        { [branch.stableId]: branch },
      );

      expect(changes).toHaveLength(2);
      expect(changes[0]).toBeInstanceOf(DropRlsPolicy);
      expect(changes[1]).toBeInstanceOf(CreateRlsPolicy);
      expect(changes[0].serialize()).toBe(
        "DROP POLICY test_policy ON public.test_table",
      );
      expect(changes[1].serialize()).toBe(
        "CREATE POLICY test_policy ON public.test_table AS RESTRICTIVE FOR SELECT USING (user_id = current_user_id())",
      );
    });

    test("alter using expression", () => {
      const props: Omit<RlsPolicyProps, "using_expression"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        with_check_expression: null,
        owner: "test",
        comment: null,
      };
      const policy = new RlsPolicy({
        ...props,
        using_expression: "old_expr",
      });

      const change = new AlterRlsPolicySetUsingExpression({
        policy,
        usingExpression: "new_expr",
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table USING (new_expr)",
      );
    });

    test("clear using expression -> USING (true)", () => {
      const props: Omit<RlsPolicyProps, "using_expression"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        with_check_expression: null,
        owner: "test",
        comment: null,
      };
      const policy = new RlsPolicy({
        ...props,
        using_expression: "old_expr",
      });

      const change = new AlterRlsPolicySetUsingExpression({
        policy,
        usingExpression: null,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table USING (true)",
      );
    });

    test("alter with check expression", () => {
      const props: Omit<RlsPolicyProps, "with_check_expression"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        using_expression: "expr",
        owner: "test",
        comment: null,
      };
      const policy = new RlsPolicy({
        ...props,
        with_check_expression: "old_check",
      });

      const change = new AlterRlsPolicySetWithCheckExpression({
        policy,
        withCheckExpression: "new_check",
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table WITH CHECK (new_check)",
      );
    });

    test("clear with check expression -> WITH CHECK (true)", () => {
      const props: Omit<RlsPolicyProps, "with_check_expression"> = {
        schema: "public",
        name: "test_policy",
        table_name: "test_table",
        command: "r",
        permissive: true,
        roles: ["public"],
        using_expression: "expr",
        owner: "test",
        comment: null,
      };
      const policy = new RlsPolicy({
        ...props,
        with_check_expression: "old_check",
      });

      const change = new AlterRlsPolicySetWithCheckExpression({
        policy,
        withCheckExpression: null,
      });

      expect(change.serialize()).toBe(
        "ALTER POLICY public.test_policy ON public.test_table WITH CHECK (true)",
      );
    });
  });
});
