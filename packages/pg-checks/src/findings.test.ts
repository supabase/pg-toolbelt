import { describe, expect, test } from "bun:test";
import { parseCheckError, parseFindings } from "./findings.ts";
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
        fix: "https://supabase.com/docs/guides/database/database-linter?lint=rls_disabled_in_public",
        docs: "https://supabase.com/docs/guides/database/database-linter?lint=rls_disabled_in_public",
      },
      {
        rule: "function_search_path_mutable",
        severity: "warn",
        schema: "public",
        name: "bar",
        type: "function",
        detail: "public.bar finding",
        fix: "https://supabase.com/docs/guides/database/database-linter?lint=function_search_path_mutable",
        docs: "https://supabase.com/docs/guides/database/database-linter?lint=function_search_path_mutable",
      },
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
