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
        splinterLevel: "ERROR",
        detail: "public.foo finding",
        fixes: expect.any(Array),
        docs: "https://supabase.com/docs/guides/database/database-linter?lint=rls_disabled_in_public",
      },
      {
        rule: "function_search_path_mutable",
        severity: "warn",
        schema: "public",
        name: "bar",
        type: "function",
        splinterLevel: "ERROR",
        detail: "public.bar finding",
        fixes: expect.any(Array),
        docs: "https://supabase.com/docs/guides/database/database-linter?lint=function_search_path_mutable",
      },
    ]);
  });

  test("fixes name the object, per rule and intent; docs stays splinter's URL", () => {
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
    expect(
      Object.fromEntries(
        findings.map((f) => [f.rule, f.fixes.map((fix) => fix.kind)]),
      ),
    ).toEqual({
      rls_disabled_in_public: ["statement", "template"],
      rls_enabled_no_policy: ["statement", "template"],
      policy_exists_rls_disabled: ["statement"],
      security_definer_view: ["statement"],
      rls_policy_always_true: ["template"],
      sensitive_columns_exposed: ["template", "guidance"],
      auth_users_exposed: ["statement", "guidance"],
      function_search_path_mutable: ["guidance"],
      rls_references_user_metadata: ["guidance"],
    });
    for (const finding of findings) {
      const object = `${finding.schema}.${finding.name}`;
      for (const fix of finding.fixes) {
        expect(fix.label.length).toBeGreaterThan(0);
        expect(fix.why.length).toBeGreaterThan(0);
        if (fix.kind === "guidance") expect(fix.sql).toBeNull();
        else expect(fix.sql).not.toBeNull();
        if (fix.kind === "template") expect(fix.sql).toMatch(/<[a-z_]+>/);
        if (fix.kind === "statement") expect(fix.sql).not.toMatch(/<[a-z_]+>/);
        // Every fix names its object, quoted in SQL when needed.
        expect(`${fix.sql ?? ""} ${fix.why}`).toContain(
          finding.name === "Profiles" ? 'public."Profiles"' : object,
        );
      }
    }
    expect(Object.fromEntries(findings.map((f) => [f.rule, f.fixes])))
      .toMatchInlineSnapshot(`
      {
        "auth_users_exposed": [
          {
            "kind": "statement",
            "label": "Revoke API access",
            "sql": "revoke select on public.members from anon, authenticated;",
            "why": "public.members exposes auth.users to the API; the API roles can no longer read it.",
          },
          {
            "kind": "guidance",
            "label": "Use a profiles table",
            "sql": null,
            "why": "Drop public.members and copy the columns you need into a table with RLS, e.g. public.profiles filled by a trigger on auth.users.",
          },
        ],
        "function_search_path_mutable": [
          {
            "kind": "guidance",
            "label": "Pin the search_path",
            "sql": null,
            "why": "Function public.f resolves names through the caller's search_path. Set search_path = '' on it (every overload) and schema-qualify every object its body references.",
          },
        ],
        "policy_exists_rls_disabled": [
          {
            "kind": "statement",
            "label": "Enable RLS",
            "sql": "alter table public.blog enable row level security;",
            "why": "The policies on public.blog have no effect until RLS is on. Check that they allow what the API needs before enabling it.",
          },
        ],
        "rls_disabled_in_public": [
          {
            "kind": "statement",
            "label": "Restrict to service_role",
            "sql": 
      "alter table public."Profiles" enable row level security;
      create policy "service_role only" on public."Profiles" for all using (false);"
      ,
            "why": "Only service_role can read or write public."Profiles"; anon and authenticated get no rows.",
          },
          {
            "kind": "template",
            "label": "Allow access per user",
            "sql": 
      "alter table public."Profiles" enable row level security;
      create policy "owner access" on public."Profiles" for <command> to authenticated using (auth.uid() = <owner_column>);"
      ,
            "why": "Enable RLS on public."Profiles" and add a policy for each role and command that needs access.",
          },
        ],
        "rls_enabled_no_policy": [
          {
            "kind": "statement",
            "label": "State service_role only",
            "sql": "create policy "service_role only" on app.customers for all using (false);",
            "why": "app.customers has RLS and no policy, so only service_role can use it. If that is intended, say so with a deny-all policy.",
          },
          {
            "kind": "template",
            "label": "Allow access per user",
            "sql": "create policy "owner access" on app.customers for <command> to authenticated using (auth.uid() = <owner_column>);",
            "why": "Add a policy on app.customers for each role and command that needs access.",
          },
        ],
        "rls_policy_always_true": [
          {
            "kind": "template",
            "label": "Narrow the policy",
            "sql": "alter policy "allow all" on public.posts using (<condition>) with check (<condition>);",
            "why": "Policy "allow all" on public.posts allows every row; replace true with the condition that should apply.",
          },
        ],
        "rls_references_user_metadata": [
          {
            "kind": "guidance",
            "label": "Stop trusting user_metadata",
            "sql": null,
            "why": "A policy on public.docs reads user_metadata, which users can edit. Base it on app_metadata or on a table you control.",
          },
        ],
        "security_definer_view": [
          {
            "kind": "statement",
            "label": "Use the caller's permissions",
            "sql": "alter view public.v set (security_invoker = on);",
            "why": "public.v then reads its tables with the caller's permissions and RLS, so callers without access to those tables lose rows.",
          },
        ],
        "sensitive_columns_exposed": [
          {
            "kind": "template",
            "label": "Enable RLS with policies",
            "sql": 
      "alter table public.users enable row level security;
      create policy "owner access" on public.users for <command> to authenticated using (auth.uid() = <owner_column>);"
      ,
            "why": "public.users has sensitive columns and no RLS; enable it and add policies for the roles that need access.",
          },
          {
            "kind": "guidance",
            "label": "Move the sensitive columns",
            "sql": null,
            "why": "Move the sensitive columns of public.users to a table in a schema the API does not expose.",
          },
        ],
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

  test("keeps splinter's own level next to the policy severity", () => {
    const at = (level: unknown) => ({
      ...row("rls_enabled_no_policy", "public", "t"),
      level,
    });
    const findings = parseFindings(
      [at("ERROR"), at("WARN"), at("INFO"), at("FATAL"), at(undefined)],
      resolvePolicy({ rls_enabled_no_policy: "error" }),
    );
    expect(findings.map((f) => [f.severity, f.splinterLevel])).toEqual([
      ["error", "ERROR"],
      ["error", "WARN"],
      ["error", "INFO"],
      ["error", null],
      ["error", null],
    ]);
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
    expect(
      result.errors.map((f) => [f.rule, f.severity, f.name, f.splinterLevel]),
    ).toEqual([["rls_disabled_in_public", "error", "foo", "ERROR"]]);
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
