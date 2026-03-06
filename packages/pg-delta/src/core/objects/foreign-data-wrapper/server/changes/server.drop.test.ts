import { describe, expect, test } from "bun:test";
import { Server } from "../server.model.ts";
import { DropServer } from "./server.drop.ts";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";

describe("server", () => {
  test("drop", async () => {
    const server = new Server({
      name: "test_server",
      owner: "test",
      foreign_data_wrapper: "test_fdw",
      type: null,
      version: null,
      options: null,
      comment: null,
      privileges: [],
    });

    const change = new DropServer({
      server,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP SERVER test_server");
  });
});
