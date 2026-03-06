import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { Extension } from "../extension.model.ts";
import { DropExtension } from "./extension.drop.ts";

describe("extension", () => {
  test("drop", async () => {
    const extension = new Extension({
      name: "test_extension",
      schema: "public",
      relocatable: true,
      version: "1.0",
      owner: "test",
      comment: null,
      members: [],
    });

    const change = new DropExtension({
      extension,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP EXTENSION test_extension");
  });
});
