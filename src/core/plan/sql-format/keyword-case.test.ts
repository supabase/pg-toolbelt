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
  it("transforms standard keywords", () => {
    expect(applyKeywordCase("create table my_table", upperOpts))
      .toMatchInlineSnapshot(`"CREATE TABLE my_table"`);
    expect(applyKeywordCase("CREATE TABLE my_table", lowerOpts))
      .toMatchInlineSnapshot(`"create table my_table"`);
  });

  it("preserves quoted/comment content", () => {
    expect(
      applyKeywordCase("create -- drop table\ntable foo default 'create table'", upperOpts),
    ).toMatchInlineSnapshot(`
      "CREATE -- drop table
      TABLE foo DEFAULT 'create table'"
    `);
  });

  it("covers expanded lowercase keywords", () => {
    expect(
      applyKeywordCase(
        "REVOKE GRANT OPTION FOR USAGE ON SCHEMA app FROM role_x; PARALLEL SAFE PARALLEL UNSAFE AS RESTRICTIVE RESTRICTED LOGIN NOSUPERUSER CREATEDB;",
        lowerOpts,
      ),
    ).toMatchInlineSnapshot(
      `"revoke grant option for usage on schema app from role_x; parallel safe parallel unsafe as restrictive restricted login nosuperuser createdb;"`,
    );
  });

  it("does not normalize PUBLIC", () => {
    expect(applyKeywordCase("GRANT USAGE ON SCHEMA public TO PUBLIC;", lowerOpts))
      .toMatchInlineSnapshot(`"grant usage on schema public to PUBLIC;"`);
    expect(applyKeywordCase("GRANT USAGE ON SCHEMA public TO PUBLIC;", upperOpts))
      .toMatchInlineSnapshot(`"GRANT USAGE ON SCHEMA public TO PUBLIC;"`);
  });

  it("preserves key=value lines in multiline blocks", () => {
    const sql = `CREATE COLLATION public.test (
  LOCALE = 'en_US',
  DETERMINISTIC = false,
  VERSION = '1.0'
)`;

    expect(applyKeywordCase(sql, lowerOpts)).toMatchInlineSnapshot(`
      "create collation public.test (
        LOCALE = 'en_US',
        DETERMINISTIC = false,
        VERSION = '1.0'
      )"
    `);
    expect(applyKeywordCase(sql, upperOpts)).toMatchInlineSnapshot(`
      "CREATE COLLATION public.test (
        LOCALE = 'en_US',
        DETERMINISTIC = false,
        VERSION = '1.0'
      )"
    `);
  });

  it("preserves key=value settings inside SET/WITH/OPTIONS/RESET parentheses", () => {
    const sql =
      "ALTER PUBLICATION pub_custom SET (publish = 'insert, update', publish_via_partition_root = false)";

    expect(applyKeywordCase(sql, lowerOpts)).toMatchInlineSnapshot(
      `"alter publication pub_custom set (publish = 'insert, update', publish_via_partition_root = false)"`,
    );
    expect(applyKeywordCase(sql, upperOpts)).toMatchInlineSnapshot(
      `"ALTER PUBLICATION pub_custom SET (publish = 'insert, update', publish_via_partition_root = false)"`,
    );
  });
});
