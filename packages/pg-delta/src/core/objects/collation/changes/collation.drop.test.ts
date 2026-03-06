import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { Collation } from "../collation.model.ts";
import { DropCollation } from "./collation.drop.ts";

describe("collation", () => {
  test("drop", async () => {
    const collation = new Collation({
      schema: "public",
      name: "test",
      provider: "c",
      is_deterministic: true,
      encoding: 1,
      collate: "en_US",
      locale: "en_US",
      version: "1.0",
      ctype: "test",
      icu_rules: "test",
      owner: "test",
      comment: null,
    });

    const change = new DropCollation({
      collation,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP COLLATION public.test");
  });
});
