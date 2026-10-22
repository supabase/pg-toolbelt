import { describe, expect, test } from "bun:test";
import {
  parseCheckError,
  parseFindings,
  parseInTransactionWarnRead,
} from "./findings.ts";
import { resolvePolicy } from "./policy.ts";

const row = (
  name: string,
  schema: string,
  relation: string,
  type = "table",
) => ({
  name,
  title: "t",
  level: "ERROR",
  facing: "EXTERNAL",
  categories: ["SECURITY"],
  description: "d",
  detail: `${schema}.${relation} finding`,
  remediation: `https://supabase.com/docs/guides/database/database-linter?lint=${name}`,
  metadata: { schema, name: relation, type },
  cache_key: `${name}_${schema}_${relation}`,
});

describe("parseFindings", () => {
  test("maps splinter rows to the RFC §8 shape with the policy severity", () => {
    const policy = resolvePolicy({ rls_disabled_in_public: "error" });
    expect(
      parseFindings(
        [
          row("rls_disabled_in_public", "public", "foo"),
          row("function_search_path_mutable", "public", "bar", "function"),
          row("unindexed_foreign_keys", "public", "baz"),
        ],
        policy,
      ),
    ).toEqual([
      {
        rule: "rls_disabled_in_public",
        severity: "error",
        schema: "public",
        name: "foo",
        type: "table",
        detail: "public.foo finding",
        fix: "alter table public.foo enable row level security; then add a policy for each role that needs access: create policy ... on public.foo for <command> to <role> using (<condition>);",
        docs: "https://supabase.com/docs/guides/database/database-linter?lint=rls_disabled_in_public",
      },
      {
        rule: "function_search_path_mutable",
        severity: "warn",
        schema: "public",
        name: "bar",
        type: "function",
        detail: "public.bar finding",
        fix: "alter function public.bar set search_path = ''; then schema-qualify every object its body references.",
        docs: "https://supabase.com/docs/guides/database/database-linter?lint=function_search_path_mutable",
      },
    ]);
  });

  test("fix text names the object, per rule; docs stays splinter's URL", () => {
    const withMetadata = (
      base: ReturnType<typeof row>,
      extra: Record<string, unknown>,
    ) => ({ ...base, metadata: { ...base.metadata, ...extra } });
    const findings = parseFindings(
      [
        row("rls_disabled_in_public", "public", "Profiles"),
        row("rls_enabled_no_policy", "app", "customers"),
        row("policy_exists_rls_disabled", "public", "blog"),
        row("security_definer_view", "public", "v", "view"),
        withMetadata(row("rls_policy_always_true", "public", "posts"), {
          policy_name: "allow all",
        }),
        row("sensitive_columns_exposed", "public", "users"),
        row("auth_users_exposed", "public", "members", "view"),
        row("function_search_path_mutable", "public", "f", "function"),
        row("rls_references_user_metadata", "public", "docs"),
      ],
      resolvePolicy({}),
    );
    expect(Object.fromEntries(findings.map((f) => [f.rule, f.fix])))
      .toMatchInlineSnapshot(`
      {
        "auth_users_exposed": "View public.members exposes auth.users to the API: revoke select on public.members from anon, authenticated; or drop it and copy the columns you need into a table with RLS (e.g. public.profiles filled by a trigger on auth.users).",
        "function_search_path_mutable": "alter function public.f set search_path = ''; then schema-qualify every object its body references.",
        "policy_exists_rls_disabled": "The policies on public.blog have no effect until RLS is on: alter table public.blog enable row level security;",
        "rls_disabled_in_public": "alter table public."Profiles" enable row level security; then add a policy for each role that needs access: create policy ... on public."Profiles" for <command> to <role> using (<condition>);",
        "rls_enabled_no_policy": "If only service_role should use this table, state it: create policy "service_role only" on app.customers for all using (false); otherwise add a policy for the roles that need access.",
        "rls_policy_always_true": "Policy "allow all" on public.posts allows every row: alter policy "allow all" on public.posts using (<condition>) with check (<condition>);",
        "rls_references_user_metadata": "A policy on public.docs reads user_metadata, which users can edit: base it on app_metadata or on a table you control.",
        "security_definer_view": "alter view public.v set (security_invoker = on);",
        "sensitive_columns_exposed": "public.users has sensitive columns and no RLS: alter table public.users enable row level security; and add policies, or move those columns to a table the API cannot read.",
      }
    `);
    expect(new Set(findings.map((f) => f.docs))).toEqual(
      new Set(
        findings.map(
          (f) =>
            `https://supabase.com/docs/guides/database/database-linter?lint=${f.rule}`,
        ),
      ),
    );
  });

  test("drops rows for rules the policy turned off", () => {
    const policy = resolvePolicy({ rls_disabled_in_public: "off" });
    expect(
      parseFindings([row("rls_disabled_in_public", "public", "foo")], policy),
    ).toEqual([]);
  });
});

describe("parseCheckError", () => {
  test("SB001 carries errors and warnings from DETAIL", () => {
    const detail = JSON.stringify({
      errors: [row("rls_disabled_in_public", "public", "foo")],
      warnings: [row("rls_enabled_no_policy", "public", "bar")],
    });
    const result = parseCheckError({
      code: "SB001",
      message: "security check failed",
      detail,
    });
    expect(result?.kind).toBe("blocked");
    if (result?.kind !== "blocked") return;
    expect(result.errors.map((f) => [f.rule, f.severity, f.name])).toEqual([
      ["rls_disabled_in_public", "error", "foo"],
    ]);
    expect(result.warnings.map((f) => [f.rule, f.severity, f.name])).toEqual([
      ["rls_enabled_no_policy", "warn", "bar"],
    ]);
  });

  test("SB002 is a timeout", () => {
    expect(
      parseCheckError({ code: "SB002", message: "security check timed out" }),
    ).toEqual({
      kind: "timed_out",
      message: "security check timed out",
    });
  });

  test("a raw 57014 is a timeout only when the check statement raised it", () => {
    const cancel = {
      code: "57014",
      message: "canceling statement due to statement timeout",
    };
    expect(parseCheckError(cancel, { fromCheck: true })).toEqual({
      kind: "timed_out",
      message: "canceling statement due to statement timeout",
    });
    expect(parseCheckError(cancel)).toBeNull();
    expect(parseCheckError(cancel, { fromCheck: false })).toBeNull();
  });

  test("anything else is not a check error", () => {
    expect(
      parseCheckError({ code: "42P01", message: "relation does not exist" }),
    ).toBeNull();
    expect(parseCheckError(new Error("boom"))).toBeNull();
    expect(parseCheckError(null)).toBeNull();
  });

  test("an SB001 with an unreadable DETAIL is reported, not swallowed", () => {
    expect(() => parseCheckError({ code: "SB001", detail: "{" })).toThrow(
      /DETAIL/,
    );
  });
});

describe("parseInTransactionWarnRead", () => {
  const policy = resolvePolicy({ rls_disabled_in_public: "error" });

  test("finds the sentinel row by column name and parses its findings", () => {
    const sentinel = JSON.stringify({
      findings: [
        row("rls_disabled_in_public", "public", "foo"),
        row("rls_enabled_no_policy", "public", "bar"),
      ],
    });
    const result = parseInTransactionWarnRead(
      [{ answer: 42 }, { sbc_findings: sentinel }],
      policy,
    );
    expect(
      "findings" in result
        ? result.findings.map((f) => [f.rule, f.severity, f.name])
        : result,
    ).toEqual([
      ["rls_disabled_in_public", "error", "foo"],
      ["rls_enabled_no_policy", "warn", "bar"],
    ]);
  });

  test("zero findings is an empty list", () => {
    expect(
      parseInTransactionWarnRead(
        [{ sbc_findings: JSON.stringify({ findings: [] }) }],
        policy,
      ),
    ).toEqual({ findings: [] });
  });

  test("a read error is reported, not thrown", () => {
    expect(
      parseInTransactionWarnRead(
        [
          {
            sbc_findings: JSON.stringify({
              read_error: "57014: canceling statement due to statement timeout",
            }),
          },
        ],
        policy,
      ),
    ).toEqual({
      readError: "57014: canceling statement due to statement timeout",
    });
  });

  test("rows without the sentinel are a read error, never findings", () => {
    expect(
      parseInTransactionWarnRead(
        [row("rls_disabled_in_public", "public", "foo")],
        policy,
      ),
    ).toEqual({ readError: "no sbc_findings row in the result" });
    expect(
      parseInTransactionWarnRead([{ sbc_findings: "{" }], policy),
    ).toMatchObject({ readError: expect.stringContaining("unreadable") });
  });
});
