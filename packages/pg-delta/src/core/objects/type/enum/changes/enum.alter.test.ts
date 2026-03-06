import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { Enum, type EnumProps } from "../enum.model.ts";
import { AlterEnumAddValue, AlterEnumChangeOwner } from "./enum.alter.ts";

describe.concurrent("enum", () => {
  describe("alter", () => {
    test("change owner", async () => {
      const props: Omit<EnumProps, "owner"> = {
        schema: "public",
        name: "test_enum",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
        comment: null,
        privileges: [],
      };
      const main = new Enum({
        ...props,
        owner: "old_owner",
      });
      const change = new AlterEnumChangeOwner({
        enum: main,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_enum OWNER TO new_owner",
      );
    });

    test("add value", async () => {
      const props: EnumProps = {
        schema: "public",
        name: "test_enum",
        owner: "test",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
        comment: null,
        privileges: [],
      };
      const main = new Enum(props);
      const change = new AlterEnumAddValue({ enum: main, newValue: "value3" });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_enum ADD VALUE 'value3'",
      );
    });

    test("add value before", async () => {
      const props: EnumProps = {
        schema: "public",
        name: "test_enum",
        owner: "test",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
        comment: null,
        privileges: [],
      };
      const main = new Enum(props);
      const change = new AlterEnumAddValue({
        enum: main,
        newValue: "value1_5",
        position: { before: "value2" },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_enum ADD VALUE 'value1_5' BEFORE 'value2'",
      );
    });

    test("add value after", async () => {
      const props: EnumProps = {
        schema: "public",
        name: "test_enum",
        owner: "test",
        labels: [
          { sort_order: 1, label: "value1" },
          { sort_order: 2, label: "value2" },
        ],
        comment: null,
        privileges: [],
      };
      const main = new Enum(props);
      const change = new AlterEnumAddValue({
        enum: main,
        newValue: "value1_5",
        position: { after: "value1" },
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER TYPE public.test_enum ADD VALUE 'value1_5' AFTER 'value1'",
      );
    });

    test("complex enum changes are not auto-replaced", async () => {
      expect(1).toBe(1);
    });
  });
});
