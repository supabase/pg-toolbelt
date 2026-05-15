import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import {
  ForeignDataWrapper,
  type ForeignDataWrapperProps,
} from "../foreign-data-wrapper.model.ts";
import {
  AlterForeignDataWrapperChangeOwner,
  AlterForeignDataWrapperSetOptions,
} from "./foreign-data-wrapper.alter.ts";

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
          { action: "ADD", option: "use_remote_estimate", value: "true" },
          { action: "SET", option: "fetch_size", value: "200" },
          { action: "DROP", option: "fdw_tuple_cost" },
        ],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (ADD use_remote_estimate 'true', SET fetch_size '200', DROP fdw_tuple_cost)",
      );
    });

    test("redacts sensitive option values to prevent secret leakage (CLI-1467)", async () => {
      const props: ForeignDataWrapperProps = {
        name: "leaky_fdw",
        owner: "postgres",
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
          { action: "ADD", option: "password", value: "shared-fdw-secret" },
          { action: "SET", option: "use_remote_estimate", value: "true" },
          { action: "ADD", option: "api_key", value: "leaked-api-key" },
        ],
      });

      await assertValidSql(change.serialize());

      const sql = change.serialize();
      expect(sql).not.toContain("shared-fdw-secret");
      expect(sql).not.toContain("leaked-api-key");
      expect(sql).toContain("SET use_remote_estimate 'true'");
      expect(sql).toContain("ADD password '__OPTION_PASSWORD__'");
      expect(sql).toContain("ADD api_key '__OPTION_API_KEY__'");
    });
  });
});
