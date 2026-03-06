import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { Collation } from "../collation.model.ts";
import {
  AlterCollationChangeOwner,
  AlterCollationRefreshVersion,
} from "./collation.alter.ts";

describe.concurrent("collation", () => {
  describe("alter", () => {
    test("change owner", async () => {
      const collation = new Collation({
        schema: "public",
        name: "test",
        provider: "c",
        is_deterministic: true,
        encoding: 1,
        collate: "en_US",
        locale: "en_US",
        version: "1.0",
        ctype: "test",
        icu_rules: "test",
        comment: null,
        owner: "old_owner",
      });

      const change = new AlterCollationChangeOwner({
        collation,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER COLLATION public.test OWNER TO new_owner",
      );
    });

    test("refresh version", async () => {
      const collation = new Collation({
        schema: "public",
        name: "test",
        provider: "c",
        is_deterministic: true,
        encoding: 1,
        collate: "en_US",
        locale: "en_US",
        ctype: "test",
        icu_rules: "test",
        comment: null,
        owner: "test",
        version: "1.0",
      });

      const change = new AlterCollationRefreshVersion({
        collation,
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER COLLATION public.test REFRESH VERSION",
      );
    });

    // replace behavior moved into collation.diff.ts as separate Drop + Create
  });
});
