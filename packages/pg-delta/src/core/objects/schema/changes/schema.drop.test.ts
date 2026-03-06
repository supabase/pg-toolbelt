import { describe, expect, test } from "bun:test";
import { Schema } from "../schema.model.ts";
import { DropSchema } from "./schema.drop.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

describe("schema", () => {
  test("drop", async () => {
    const schema = new Schema({
      name: "test_schema",
      owner: "test",
      comment: null,
      privileges: [],
    });

    const change = new DropSchema({
      schema,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP SCHEMA test_schema");
  });
});
