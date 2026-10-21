import { describe, expect, test } from "bun:test";
import { splitSplinter } from "../scripts/splinter-shape.ts";
import { PolicyError, RULES, resolvePolicy } from "./policy.ts";
import { SPLINTER_PREAMBLE, SPLINTER_QUERY } from "./vendor/splinter.ts";

describe("resolvePolicy", () => {
  test("absent configuration resolves every rule to warn with no exclusions", () => {
    const policy = resolvePolicy(undefined);
    expect(Object.values(policy.severities)).toEqual(RULES.map(() => "warn"));
    expect(policy.exclude).toEqual([]);
  });

  test("keeps explicit severities and defaults the rest to warn", () => {
    const policy = resolvePolicy({
      rls_disabled_in_public: "error",
      function_search_path_mutable: "off",
      exclude: ["public.legacy", "app.audit_log"],
    });
    expect(policy.severities.rls_disabled_in_public).toBe("error");
    expect(policy.severities.function_search_path_mutable).toBe("off");
    expect(policy.severities.security_definer_view).toBe("warn");
    expect(policy.exclude).toEqual(["public.legacy", "app.audit_log"]);
  });

  test("rejects unknown rules, unknown severities and malformed exclusions together", () => {
    let caught: unknown;
    try {
      resolvePolicy({
        rls_disabled_in_publik: "error",
        rls_enabled_no_policy: "level",
        exclude: ["foo", "a.b.c", " .x", "public.ok"],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PolicyError);
    expect((caught as PolicyError).issues).toEqual([
      'unknown rule "rls_disabled_in_publik"',
      'rule "rls_enabled_no_policy": severity must be "error", "warn" or "off", got "level"',
      'exclude[0]: expected "schema.relation", got "foo"',
      'exclude[1]: expected "schema.relation", got "a.b.c"',
      'exclude[2]: expected "schema.relation", got " .x"',
    ]);
  });

  test("rejects a non-object policy and a non-array exclude", () => {
    expect(() => resolvePolicy("error")).toThrow(/policy must be an object/);
    expect(() => resolvePolicy({ exclude: "public.foo" })).toThrow(
      /exclude must be an array of strings/,
    );
  });
});

describe("RULES", () => {
  test("every rule exists in the vendored splinter as a SECURITY rule that needs no preamble", () => {
    const shape = splitSplinter(
      `set local search_path = '';\n${SPLINTER_PREAMBLE}\n${SPLINTER_QUERY}`,
    );
    for (const rule of RULES) {
      const found = shape.rules.find((r) => r.name === rule);
      expect(found, rule).toBeDefined();
      expect(found?.categories).toContain("SECURITY");
      expect(found?.readsSplinterSettings).toBe(false);
    }
  });
});
