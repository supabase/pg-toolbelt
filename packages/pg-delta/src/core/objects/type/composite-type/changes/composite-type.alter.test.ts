import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import {
  CompositeType,
  type CompositeTypeProps,
} from "../composite-type.model.ts";
import {
  AlterCompositeTypeAddAttribute,
  AlterCompositeTypeAlterAttributeType,
  AlterCompositeTypeChangeOwner,
  AlterCompositeTypeDropAttribute,
} from "./composite-type.alter.ts";

describe.concurrent("composite-type", () => {
  describe("alter", () => {
    test("change owner", async () => {
      const props: Omit<CompositeTypeProps, "owner"> = {
        schema: "public",
        name: "test_type",
        row_security: false,
        force_row_security: false,
        has_indexes: false,
        has_rules: false,
        has_triggers: false,
        has_subclasses: false,
        is_populated: false,
        replica_identity: "d",
        is_partition: false,
        options: null,
        partition_bound: null,
        comment: null,
        columns: [],
        privileges: [],
      };
      const main = new CompositeType({
        ...props,
        owner: "old_owner",
      });
      const change = new AlterCompositeTypeChangeOwner({
        compositeType: main,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_type OWNER TO new_owner",
      );
    });
  });

  test("add attribute", async () => {
    const base = {
      schema: "public",
      name: "ct",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "o1",
      comment: null,
      privileges: [],
    } as const;
    const branch = new CompositeType({
      ...base,
      columns: [
        {
          name: "a",
          position: 1,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });
    const change = new AlterCompositeTypeAddAttribute({
      compositeType: branch,
      attribute: branch.columns[0],
    });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      "ALTER TYPE public.ct ADD ATTRIBUTE a text",
    );
  });

  test("drop attribute", async () => {
    const base = {
      schema: "public",
      name: "ct",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "o1",
      comment: null,
      privileges: [],
    } as const;
    const main = new CompositeType({
      ...base,
      columns: [
        {
          name: "a",
          position: 1,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: null,
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });
    const change = new AlterCompositeTypeDropAttribute({
      compositeType: main,
      attribute: main.columns[0],
    });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe("ALTER TYPE public.ct DROP ATTRIBUTE a");
  });

  test("alter attribute type and collation", async () => {
    const base = {
      schema: "public",
      name: "ct",
      row_security: false,
      force_row_security: false,
      has_indexes: false,
      has_rules: false,
      has_triggers: false,
      has_subclasses: false,
      is_populated: false,
      replica_identity: "d",
      is_partition: false,
      options: null,
      partition_bound: null,
      owner: "o1",
      comment: null,
      privileges: [],
    } as const;
    const branch = new CompositeType({
      ...base,
      columns: [
        {
          name: "a",
          position: 1,
          data_type: "text",
          data_type_str: "text",
          is_custom_type: false,
          custom_type_type: null,
          custom_type_category: null,
          custom_type_schema: null,
          custom_type_name: null,
          not_null: false,
          is_identity: false,
          is_identity_always: false,
          is_generated: false,
          collation: '"en_US"',
          default: null,
          comment: null,
        },
      ],
      privileges: [],
    });
    const change = new AlterCompositeTypeAlterAttributeType({
      compositeType: branch,
      attribute: branch.columns[0],
    });
    await assertValidSql(change.serialize());
    expect(change.serialize()).toBe(
      'ALTER TYPE public.ct ALTER ATTRIBUTE a TYPE text COLLATE "en_US"',
    );
  });
});
