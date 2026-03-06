import { describe, expect, test } from "bun:test";
import {
  ForeignDataWrapper,
  type ForeignDataWrapperProps,
} from "../foreign-data-wrapper.model.ts";
import {
  AlterForeignDataWrapperChangeOwner,
  AlterForeignDataWrapperSetOptions,
} from "./foreign-data-wrapper.alter.ts";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";

describe.concurrent("foreign-data-wrapper", () => {
  describe("alter", () => {
    test("change owner", async () => {
      const props: ForeignDataWrapperProps = {
        name: "test_fdw",
        owner: "old_owner",
        handler: null,
        validator: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const fdw = new ForeignDataWrapper(props);
      const change = new AlterForeignDataWrapperChangeOwner({
        foreignDataWrapper: fdw,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN DATA WRAPPER test_fdw OWNER TO new_owner",
      );
    });

    test("set options ADD", async () => {
      const props: ForeignDataWrapperProps = {
        name: "test_fdw",
        owner: "test",
        handler: null,
        validator: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const fdw = new ForeignDataWrapper(props);
      const change = new AlterForeignDataWrapperSetOptions({
        foreignDataWrapper: fdw,
        options: [
          { action: "ADD", option: "host", value: "localhost" },
          { action: "ADD", option: "port", value: "5432" },
        ],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (ADD host 'localhost', ADD port '5432')",
      );
    });

    test("set options SET", async () => {
      const props: ForeignDataWrapperProps = {
        name: "test_fdw",
        owner: "test",
        handler: null,
        validator: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const fdw = new ForeignDataWrapper(props);
      const change = new AlterForeignDataWrapperSetOptions({
        foreignDataWrapper: fdw,
        options: [{ action: "SET", option: "host", value: "newhost" }],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (SET host 'newhost')",
      );
    });

    test("set options DROP", async () => {
      const props: ForeignDataWrapperProps = {
        name: "test_fdw",
        owner: "test",
        handler: null,
        validator: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const fdw = new ForeignDataWrapper(props);
      const change = new AlterForeignDataWrapperSetOptions({
        foreignDataWrapper: fdw,
        options: [{ action: "DROP", option: "host" }],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (DROP host)",
      );
    });

    test("set options mixed ADD/SET/DROP", async () => {
      const props: ForeignDataWrapperProps = {
        name: "test_fdw",
        owner: "test",
        handler: null,
        validator: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const fdw = new ForeignDataWrapper(props);
      const change = new AlterForeignDataWrapperSetOptions({
        foreignDataWrapper: fdw,
        options: [
          { action: "ADD", option: "new_option", value: "new_value" },
          { action: "SET", option: "existing_option", value: "updated_value" },
          { action: "DROP", option: "old_option" },
        ],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (ADD new_option 'new_value', SET existing_option 'updated_value', DROP old_option)",
      );
    });
  });
});
