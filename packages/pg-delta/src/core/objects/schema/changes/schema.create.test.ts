import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { Schema } from "../schema.model.ts";
import { CreateSchema } from "./schema.create.ts";

describe("schema", () => {
  test("create", async () => {
    const schema = new Schema({
      name: "test_schema",
      owner: "test",
      comment: null,
      privileges: [],
    });

    const change = new CreateSchema({
      schema,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE SCHEMA test_schema AUTHORIZATION test",
    );
  });
});
