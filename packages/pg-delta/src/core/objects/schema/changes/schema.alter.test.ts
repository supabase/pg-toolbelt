import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";
import { Schema, type SchemaProps } from "../schema.model.ts";
import { AlterSchemaChangeOwner } from "./schema.alter.ts";

describe.concurrent("schema", () => {
  describe("alter", () => {
    test("change owner", async () => {
      const props: Omit<SchemaProps, "owner"> = {
        name: "test_schema",
        comment: null,
        privileges: [],
      };
      const schemaObj = new Schema({
        ...props,
        owner: "old_owner",
      });

      const change = new AlterSchemaChangeOwner({
        schema: schemaObj,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER SCHEMA test_schema OWNER TO new_owner",
      );
    });
  });
});
