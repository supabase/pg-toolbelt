import { describe, expect, test } from "bun:test";
import { Collation } from "../collation.model.ts";
import { CreateCollation } from "./collation.create.ts";

describe("collation", () => {
  test("create minimal", () => {
    const collation = new Collation({
      schema: "public",
      name: "test",
      provider: "d",
      is_deterministic: true,
      encoding: 1,
      collate: "C",
      locale: null,
      version: null,
      ctype: "C",
      icu_rules: null,
      owner: "owner",
      comment: null,
    });

    const change = new CreateCollation({ collation });

    expect(change.serialize()).toBe(
      `CREATE COLLATION public.test (LC_COLLATE = 'C', LC_CTYPE = 'C')`,
    );
  });

  test("create with all options", () => {
    const collation = new Collation({
      schema: "public",
      name: "test",
      provider: "i",
      is_deterministic: false,
      encoding: 1,
      collate: "en_US",
      locale: "en_US",
      version: "1.0",
      ctype: "en_US",
      icu_rules: "& A < a <<< à",
      owner: "owner",
      comment: null,
    });

    const change = new CreateCollation({ collation });

    expect(change.serialize()).toBe(
      `CREATE COLLATION public.test (LOCALE = 'en_US', LC_COLLATE = 'en_US', LC_CTYPE = 'en_US', PROVIDER = icu, DETERMINISTIC = false, RULES = '& A < a <<< à', VERSION = '1.0')`,
    );
  });
});
