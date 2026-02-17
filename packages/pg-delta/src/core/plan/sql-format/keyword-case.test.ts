import { describe, expect, it } from "bun:test";
import { DEFAULT_OPTIONS } from "./constants.ts";
import { applyKeywordCase } from "./keyword-case.ts";
import type { NormalizedOptions } from "./types.ts";

const upperOpts: NormalizedOptions = {
  ...DEFAULT_OPTIONS,
  keywordCase: "upper",
};
const lowerOpts: NormalizedOptions = {
  ...DEFAULT_OPTIONS,
  keywordCase: "lower",
};

describe("applyKeywordCase", () => {
  it("transforms keywords to upper case", () => {
    const result = applyKeywordCase("create table foo", upperOpts);
    expect(result).toBe("CREATE TABLE foo");
  });

  it("transforms keywords to lower case", () => {
    const result = applyKeywordCase("CREATE TABLE foo", lowerOpts);
    expect(result).toBe("create table foo");
  });

  it("preserves non-keywords in both modes", () => {
    const upper = applyKeywordCase("create my_table", upperOpts);
    expect(upper).toBe("CREATE my_table");

    const lower = applyKeywordCase("CREATE my_table", lowerOpts);
    expect(lower).toBe("create my_table");
  });

  it("does not transform quoted identifiers", () => {
    const result = applyKeywordCase('"create" table foo', upperOpts);
    expect(result).toBe('"create" TABLE foo');
  });

  it("does not transform content inside single quotes", () => {
    const result = applyKeywordCase("default 'create table'", upperOpts);
    expect(result).toBe("DEFAULT 'create table'");
  });

  it("does not transform content inside comments", () => {
    const result = applyKeywordCase(
      "create -- drop table\ntable foo",
      upperOpts,
    );
    expect(result).toBe("CREATE -- drop table\nTABLE foo");
  });

  it("covers broader PostgreSQL keywords in lower mode", () => {
    const sql =
      "RETURNS BOOLEAN SECURITY DEFINER STABLE FROM ENABLE ROW LEVEL SECURITY PRIMARY KEY REPLICA IDENTITY FULL OWNED BY VALUES OF ALWAYS CURRENT_TIMESTAMP";
    const result = applyKeywordCase(sql, lowerOpts);
    expect(result).toBe(
      "returns boolean security definer stable from enable row level security primary key replica identity full owned by values of always current_timestamp",
    );
  });
});
