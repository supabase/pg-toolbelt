import { describe, expect, test } from "bun:test";
import { Extension } from "../extension.model.ts";
import { CreateExtension } from "./extension.create.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

describe("extension", () => {
  test("create", async () => {
    const extension = new Extension({
      name: "test_extension",
      schema: "public",
      relocatable: true,
      version: "1.0",
      owner: "test",
      comment: null,
      members: [],
    });

    const change = new CreateExtension({
      extension,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      `CREATE EXTENSION test_extension WITH SCHEMA public`,
    );
  });
});
