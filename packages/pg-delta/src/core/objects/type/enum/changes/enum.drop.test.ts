import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { Enum } from "../enum.model.ts";
import { DropEnum } from "./enum.drop.ts";

describe("enum", () => {
  test("drop", async () => {
    const enumType = new Enum({
      schema: "public",
      name: "test_enum",
      owner: "test",
      labels: [
        { sort_order: 1, label: "value1" },
        { sort_order: 2, label: "value2" },
      ],
      comment: null,
      privileges: [],
    });

    const change = new DropEnum({
      enum: enumType,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP TYPE public.test_enum");
  });
});
