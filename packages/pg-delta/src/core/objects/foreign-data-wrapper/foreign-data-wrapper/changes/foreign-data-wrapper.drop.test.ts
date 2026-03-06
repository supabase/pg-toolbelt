import { describe, expect, test } from "bun:test";
import { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import { DropForeignDataWrapper } from "./foreign-data-wrapper.drop.ts";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";

describe("foreign-data-wrapper", () => {
  test("drop", async () => {
    const fdw = new ForeignDataWrapper({
      name: "test_fdw",
      owner: "test",
      handler: null,
      validator: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new DropForeignDataWrapper({
      foreignDataWrapper: fdw,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP FOREIGN DATA WRAPPER test_fdw");
  });
});
