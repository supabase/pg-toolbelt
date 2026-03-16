import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { assertValidSql } from "../../../../../tests/assert-valid-sql.ts";
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

    expect(Effect.runSync(change.serialize())).toBe(
      "CREATE SCHEMA test_schema AUTHORIZATION test",
    );
  });
});
