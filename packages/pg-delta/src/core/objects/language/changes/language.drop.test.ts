import { describe, expect, test } from "bun:test";
import { Language } from "../language.model.ts";
import { DropLanguage } from "./language.drop.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

describe("language", () => {
  test("drop", async () => {
    const language = new Language({
      name: "plpgsql",
      is_trusted: true,
      is_procedural: true,
      call_handler: "plpgsql_call_handler",
      inline_handler: "plpgsql_inline_handler",
      validator: "plpgsql_validator",
      owner: "test",
      comment: null,
      privileges: [],
    });

    const change = new DropLanguage({
      language,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP LANGUAGE plpgsql");
  });
});
