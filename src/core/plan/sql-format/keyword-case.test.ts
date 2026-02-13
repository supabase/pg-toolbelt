import { describe, expect, it } from "vitest";
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

  it("covers SAFE, UNSAFE, and RESTRICTIVE keywords", () => {
    const sql = "PARALLEL SAFE PARALLEL UNSAFE AS RESTRICTIVE";
    const lower = applyKeywordCase(sql, lowerOpts);
    expect(lower).toBe("parallel safe parallel unsafe as restrictive");

    const upper = applyKeywordCase(lower, upperOpts);
    expect(upper).toBe("PARALLEL SAFE PARALLEL UNSAFE AS RESTRICTIVE");
  });

  it("normalizes PUBLIC in GRANT/REVOKE grantee positions", () => {
    const grant = "GRANT USAGE ON SCHEMA public TO PUBLIC;";
    const revoke = "REVOKE USAGE ON SCHEMA public FROM PUBLIC;";

    expect(applyKeywordCase(grant, lowerOpts)).toBe(
      "grant usage on schema public to public;",
    );
    expect(applyKeywordCase(revoke, lowerOpts)).toBe(
      "revoke usage on schema public from public;",
    );

    expect(applyKeywordCase(grant, upperOpts)).toBe(
      "GRANT USAGE ON SCHEMA public TO PUBLIC;",
    );
    expect(applyKeywordCase(revoke, upperOpts)).toBe(
      "REVOKE USAGE ON SCHEMA public FROM PUBLIC;",
    );
  });

  it("normalizes PUBLIC in ALTER DEFAULT PRIVILEGES grant/revoke clauses", () => {
    const grant =
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA public GRANT SELECT ON TABLES TO PUBLIC;";
    const revoke =
      "ALTER DEFAULT PRIVILEGES FOR ROLE app_user IN SCHEMA public REVOKE SELECT ON TABLES FROM PUBLIC;";

    expect(applyKeywordCase(grant, lowerOpts)).toBe(
      "alter default privileges for role app_user in schema public grant select on tables to public;",
    );
    expect(applyKeywordCase(revoke, lowerOpts)).toBe(
      "alter default privileges for role app_user in schema public revoke select on tables from public;",
    );
  });

  it("does not rewrite public schema/object identifiers", () => {
    const schemaGrant = "GRANT USAGE ON SCHEMA public TO app_user;";
    const tableFrom = "SELECT * FROM PUBLIC.table_name;";
    const functionCall = "SELECT PUBLIC.fn_name();";

    expect(applyKeywordCase(schemaGrant, upperOpts)).toBe(
      "GRANT USAGE ON SCHEMA public TO app_user;",
    );
    expect(applyKeywordCase(tableFrom, lowerOpts)).toBe(
      "select * from PUBLIC.table_name;",
    );
    expect(applyKeywordCase(functionCall, lowerOpts)).toBe(
      "select PUBLIC.fn_name();",
    );
  });
});
