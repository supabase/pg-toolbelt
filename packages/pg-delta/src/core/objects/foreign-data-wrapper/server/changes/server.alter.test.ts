import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { Server, type ServerProps } from "../server.model.ts";
import {
  AlterServerChangeOwner,
  AlterServerSetOptions,
  AlterServerSetVersion,
} from "./server.alter.ts";

describe.concurrent("server", () => {
  describe("alter", () => {
    test("change owner", async () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "old_owner",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerChangeOwner({
        server,
        owner: "new_owner",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER SERVER test_server OWNER TO new_owner",
      );
    });

    test("set version", async () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetVersion({
        server,
        version: "2.0",
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe("ALTER SERVER test_server VERSION '2.0'");
    });

    test("set version to null", async () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: "1.0",
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetVersion({
        server,
        version: null,
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe("ALTER SERVER test_server VERSION ''");
    });

    test("set options ADD", async () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetOptions({
        server,
        options: [
          { action: "ADD", option: "host", value: "localhost" },
          { action: "ADD", option: "port", value: "5432" },
        ],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER SERVER test_server OPTIONS (ADD host 'localhost', ADD port '5432')",
      );
    });

    test("set options SET", async () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetOptions({
        server,
        options: [{ action: "SET", option: "host", value: "newhost" }],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER SERVER test_server OPTIONS (SET host 'newhost')",
      );
    });

    test("set options DROP", async () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetOptions({
        server,
        options: [{ action: "DROP", option: "host" }],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER SERVER test_server OPTIONS (DROP host)",
      );
    });

    test("set options mixed ADD/SET/DROP", async () => {
      const props: ServerProps = {
        name: "test_server",
        owner: "test",
        foreign_data_wrapper: "test_fdw",
        type: null,
        version: null,
        options: null,
        comment: null,
        privileges: [],
      };
      const server = new Server(props);
      const change = new AlterServerSetOptions({
        server,
        options: [
          { action: "ADD", option: "new_option", value: "new_value" },
          { action: "SET", option: "existing_option", value: "updated_value" },
          { action: "DROP", option: "old_option" },
        ],
      });

      await assertValidSql(change.serialize());

      expect(change.serialize()).toBe(
        "ALTER SERVER test_server OPTIONS (ADD new_option 'new_value', SET existing_option 'updated_value', DROP old_option)",
      );
    });
  });
});
