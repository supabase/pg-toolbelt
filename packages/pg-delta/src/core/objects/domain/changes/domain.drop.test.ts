import { describe, expect, test } from "bun:test";
import { Domain } from "../domain.model.ts";
import { DropDomain } from "./domain.drop.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

describe("domain", () => {
  test("drop", async () => {
    const domain = new Domain({
      schema: "public",
      name: "test_domain",
      base_type: "integer",
      base_type_schema: "pg_catalog",
      not_null: false,
      type_modifier: null,
      array_dimensions: null,
      collation: null,
      default_bin: null,
      default_value: null,
      owner: "test",
      comment: null,
      constraints: [],
      privileges: [],
    });

    const change = new DropDomain({
      domain,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP DOMAIN public.test_domain");
  });
});
