import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildAfterCommitRead,
  buildCheckBlock,
  buildCheckStatements,
  quoteLiteral,
} from "./check.ts";
import { RULES, type Rule, resolvePolicy } from "./policy.ts";
import { RULE_SQL } from "./vendor/splinter.ts";

const allWarn = resolvePolicy({});

/** The lint subquery made of exactly these rules' splinter SQL. */
const lintUnion = (rules: readonly Rule[]) =>
  `from (\n${rules.map((rule) => RULE_SQL[rule]).join("\nunion all\n")}\n) l`;
const rulesSent = (sql: string) =>
  RULES.filter((rule) => sql.includes(RULE_SQL[rule] ?? "<missing>"));
const allButSearchPath: Rule[] = RULES.filter(
  (rule) => rule !== "function_search_path_mutable",
);
const blocking = resolvePolicy({
  rls_disabled_in_public: "error",
  function_search_path_mutable: "off",
  exclude: { rls_disabled_in_public: ["public.o'brien"] },
});

describe("quoteLiteral", () => {
  test("doubles quotes and switches to an escape string for backslashes", () => {
    expect(quoteLiteral("a'b")).toBe("'a''b'");
    expect(quoteLiteral("a\\b")).toBe("E'a\\\\b'");
  });
});

describe("buildCheckBlock", () => {
  test("is empty when no rule is at error", () => {
    expect(buildCheckBlock(allWarn, {})).toBe("");
    expect(buildCheckStatements(allWarn, {})).toEqual([]);
  });

  test("saves the timeout, sets the guard, checks, then restores", () => {
    const statements = buildCheckStatements(blocking, {
      timeoutMs: 1500,
      exposedSchemas: ["public", "app"],
    });
    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe(
      "select pg_catalog.set_config('sbc.statement_timeout', pg_catalog.current_setting('statement_timeout'), true)",
    );
    expect(statements[1]).toBe("set local statement_timeout = '1500ms'");
    expect(statements[3]).toBe(
      "select pg_catalog.set_config('statement_timeout', pg_catalog.current_setting('sbc.statement_timeout'), true)",
    );
    const check = statements[2] ?? "";
    expect(check).toContain(lintUnion(allButSearchPath));
    expect(rulesSent(check)).toEqual(allButSearchPath);
    const outside = check.replace(lintUnion(allButSearchPath), "<splinter>");
    expect(outside).toContain(
      "pg_catalog.set_config('pgrst.db_schemas', 'public,app', true)",
    );
    expect(outside).toContain(
      "filter (where l.name = any(array['rls_disabled_in_public']::pg_catalog.text[]))",
    );
    expect(outside).toContain(
      "array['rls_disabled_in_public']::pg_catalog.text[], array['public.o''brien']::pg_catalog.text[]) as x(rule, object)",
    );
    expect(outside).toContain("errcode = 'SB001'");
    expect(outside).toContain("errcode = 'SB002'");
    expect(buildCheckBlock(blocking, {})).toBe(
      `${buildCheckStatements(blocking, {}).join(";\n")};\n`,
    );
  });

  test("catches a cancel anywhere in the DO body, not only in the lint query", () => {
    const [, , check] = buildCheckStatements(
      resolvePolicy({ rls_disabled_in_public: "error" }),
      { exposedSchemas: ["public"] },
    );
    const body = check!.slice(check!.indexOf("\nbegin\n"));
    const handler = body.lastIndexOf("exception when query_canceled");
    expect(handler).toBeGreaterThan(
      body.indexOf("set_config('search_path', ''"),
    );
    expect(handler).toBeGreaterThan(body.indexOf("jsonb_array_length"));
    expect(handler).toBeGreaterThan(body.lastIndexOf("prev_db_schemas"));
  });

  test("rejects a non-positive timeout and a schema splinter cannot parse", () => {
    expect(() => buildCheckStatements(blocking, { timeoutMs: 0 })).toThrow(
      /timeoutMs/,
    );
    expect(() =>
      buildCheckStatements(blocking, { exposedSchemas: ["a,b"] }),
    ).toThrow(/comma/);
  });
});

describe("exclusions", () => {
  const policy = resolvePolicy({
    rls_disabled_in_public: "error",
    exclude: {
      rls_disabled_in_public: ["public.a", "public.o'brien"],
      security_definer_view: ["app.v"],
    },
  });
  const filter =
    "\nwhere not exists (select 1 from unnest(array['rls_disabled_in_public', 'rls_disabled_in_public', 'security_definer_view']::pg_catalog.text[], array['public.a', 'public.o''brien', 'app.v']::pg_catalog.text[]) as x(rule, object) where x.rule = l.name and x.object = (l.metadata->>'schema') || '.' || (l.metadata->>'name'))";

  test("filter pairs each rule with its object in the check and the read", () => {
    const check = buildCheckStatements(policy, {})[2] ?? "";
    expect(check.includes(filter)).toBe(true);
    const read = buildAfterCommitRead(policy, {});
    expect(read.statements[read.resultIndex]?.includes(filter)).toBe(true);
  });

  test("no exclusions adds no filter", () => {
    expect(buildCheckStatements(allWarn, {})).toEqual([]);
    const read = buildAfterCommitRead(allWarn, {});
    expect(
      read.statements[read.resultIndex]?.includes("as x(rule, object)"),
    ).toBe(false);
  });
});

describe("buildAfterCommitRead", () => {
  test("reads warn and error rules in a transaction it rolls back", () => {
    const read = buildAfterCommitRead(blocking, { exposedSchemas: ["public"] });
    expect(read.statements[0]).toBe("begin");
    expect(read.statements.at(-1)).toBe("rollback");
    const select = read.statements[read.resultIndex] ?? "";
    expect(select).toContain(lintUnion(allButSearchPath));
    expect(rulesSent(select)).toEqual(allButSearchPath);
    expect(read.sql).toBe(`${read.statements.join(";\n")};\n`);
  });

  test("is empty when every rule is off", () => {
    const off = resolvePolicy(
      Object.fromEntries(
        Object.keys(allWarn.severities).map((rule) => [rule, "off"]),
      ),
    );
    expect(buildAfterCommitRead(off, {}).statements).toEqual([]);
  });
});

describe("payload size", () => {
  const released = readFileSync(
    join(import.meta.dir, "vendor", "splinter.sql"),
    "utf8",
  ).length;
  const only = (rule: Rule) =>
    resolvePolicy(
      Object.fromEntries(RULES.map((r) => [r, r === rule ? "error" : "off"])),
    );

  test("sends only the selected rules' SQL, a fraction of the released file", () => {
    const one = buildCheckBlock(only("rls_disabled_in_public"), {});
    expect(rulesSent(one)).toEqual(["rls_disabled_in_public"]);
    expect(one.length).toBeLessThan(released / 15);
    const nine = buildAfterCommitRead(allWarn, {}).sql;
    expect(rulesSent(nine)).toEqual([...RULES]);
    expect(nine.length).toBeLessThan(released / 2);
  });
});
