import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { Enum } from "../enum.model.ts";
import { CreateEnum } from "./enum.create.ts";

describe("enum", () => {
  test("create", async () => {
    const enumType = new Enum({
      schema: "public",
      name: "test_enum",
      owner: "test",
      labels: [
        { sort_order: 1, label: "value1" },
        { sort_order: 2, label: "value2" },
        { sort_order: 3, label: "value3" },
      ],
      comment: null,
      privileges: [],
    });

    const change = new CreateEnum({
      enum: enumType,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "CREATE TYPE public.test_enum AS ENUM ('value1', 'value2', 'value3')",
    );
  });
});
