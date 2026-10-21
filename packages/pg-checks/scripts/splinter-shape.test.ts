import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderVendoredModule, splitSplinter } from "./splinter-shape.ts";

const vendorDir = join(import.meta.dir, "..", "src", "vendor");

const branch = (name: string, categories: string) => `(
select
    '${name}' as name,
    'T' as title,
    'WARN' as level,
    'EXTERNAL' as facing,
    array[${categories}] as categories,
    'd' as description,
    'x' as detail,
    'https://example.test/${name}' as remediation,
    jsonb_build_object('schema', 'public', 'name', 't', 'type', 'table') as metadata,
    'k' as cache_key
from pg_catalog.pg_class
limit 0)`;

const release = (body: string) => `set local search_path = '';

-- Used for 0025_public_bucket_allows_listing
do $$
begin
    perform pg_catalog.set_config('splinter.public_buckets', '[]', true);
end $$;

${body}`;

describe("splitSplinter", () => {
  test("splits a release into preamble, query and per-rule branches", () => {
    const text = release(
      `${branch("rule_a", "'SECURITY'")}\nunion all\n${branch("rule_b", "'PERFORMANCE'")}`,
    );
    const shape = splitSplinter(text);
    expect(shape.preamble.startsWith("do $$")).toBe(true);
    expect(shape.preamble.endsWith("end $$;")).toBe(true);
    expect(shape.query.startsWith("(")).toBe(true);
    expect(shape.query.endsWith(")")).toBe(true);
    expect(shape.rules).toEqual([
      {
        name: "rule_a",
        categories: ["SECURITY"],
        readsSplinterSettings: false,
      },
      {
        name: "rule_b",
        categories: ["PERFORMANCE"],
        readsSplinterSettings: false,
      },
    ]);
  });

  test("flags a branch that reads splinter.* settings set by the preamble", () => {
    const text = release(
      branch("rule_a", "'SECURITY'").replace(
        "limit 0",
        "where current_setting('splinter.public_buckets', true) is null limit 0",
      ),
    );
    expect(splitSplinter(text).rules[0]?.readsSplinterSettings).toBe(true);
  });

  test("fails loudly when the search_path header is missing", () => {
    expect(() =>
      splitSplinter(release(branch("a", "'SECURITY'")).slice(1)),
    ).toThrow(/search_path/);
  });

  test("fails loudly when a branch carries no rule name", () => {
    const text = release(`${branch("a", "'SECURITY'")}\nunion all\n(select 1)`);
    expect(() => splitSplinter(text)).toThrow(/branch 2/);
  });

  test("fails loudly when the query carries a top-level semicolon", () => {
    const text = release(`${branch("a", "'SECURITY'")};\nselect 1`);
    expect(() => splitSplinter(text)).toThrow(/end with/);
  });

  test("fails loudly when the query contains the check block's dollar-quote tag", () => {
    const text = release(
      branch("a", "'SECURITY'").replace("'x'", "$sbcq$x$sbcq$"),
    );
    expect(() => splitSplinter(text)).toThrow(/\$sbc/);
  });
});

describe("vendored splinter", () => {
  test("splinter.ts is the rendering of splinter.sql", () => {
    const sql = readFileSync(join(vendorDir, "splinter.sql"), "utf8");
    const ts = readFileSync(join(vendorDir, "splinter.ts"), "utf8");
    const version = /SPLINTER_VERSION = "([^"]+)"/.exec(ts)?.[1];
    expect(version).toBeDefined();
    expect(renderVendoredModule(sql, version ?? "")).toBe(ts);
  });
});
