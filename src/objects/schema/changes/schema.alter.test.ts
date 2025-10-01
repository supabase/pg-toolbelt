import { describe, expect, test } from "vitest";
import { Schema, type SchemaProps } from "../schema.model.ts";
import { AlterSchemaChangeOwner } from "./schema.alter.ts";

describe.concurrent("schema", () => {
  describe("alter", () => {
    test("change owner", () => {
      const props: Omit<SchemaProps, "owner"> = {
        schema: "test_schema",
        comment: null,
      };
      const schemaObj = new Schema({
        ...props,
        owner: "old_owner",
      });

      const change = new AlterSchemaChangeOwner({
        schemaObj,
        owner: "new_owner",
      });

      expect(change.serialize()).toBe(
        "ALTER SCHEMA test_schema OWNER TO new_owner",
      );
    });
  });
});
