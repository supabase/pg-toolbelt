import { describe, expect, test } from "bun:test";
import { assertValidSql } from "../../../../test-utils/assert-valid-sql.ts";
import { UserMapping } from "../user-mapping.model.ts";
import { DropUserMapping } from "./user-mapping.drop.ts";

describe("user-mapping", () => {
  test("drop", async () => {
    const userMapping = new UserMapping({
      user: "test_user",
      server: "test_server",
      options: null,
    });

    const change = new DropUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "DROP USER MAPPING FOR test_user SERVER test_server",
    );
  });

  test("drop PUBLIC user mapping", async () => {
    const userMapping = new UserMapping({
      user: "PUBLIC",
      server: "test_server",
      options: null,
    });

    const change = new DropUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "DROP USER MAPPING FOR PUBLIC SERVER test_server",
    );
  });

  test("drop CURRENT_USER mapping", async () => {
    const userMapping = new UserMapping({
      user: "CURRENT_USER",
      server: "test_server",
      options: null,
    });

    const change = new DropUserMapping({
      userMapping,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe(
      "DROP USER MAPPING FOR CURRENT_USER SERVER test_server",
    );
  });
});
