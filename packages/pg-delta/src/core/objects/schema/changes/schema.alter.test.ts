import { describe, expect, test } from "bun:test";
import { Schema, type SchemaProps } from "../schema.model.ts";
import { AlterSchemaChangeOwner } from "./schema.alter.ts";

describe.concurrent("schema", () => {
  describe("alter", () => {
    test("change owner", () => {
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

      expect(change.serialize()).toBe(
        "ALTER SCHEMA test_schema OWNER TO new_owner",
      );
    });
  });
});
