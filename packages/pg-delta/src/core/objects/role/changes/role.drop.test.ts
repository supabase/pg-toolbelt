import { describe, expect, test } from "bun:test";
import { Role } from "../role.model.ts";
import { DropRole } from "./role.drop.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

describe("role", () => {
  test("drop", async () => {
    const role = new Role({
      name: "test_role",
      is_superuser: false,
      can_inherit: true,
      can_create_roles: false,
      can_create_databases: false,
      can_login: true,
      can_replicate: false,
      connection_limit: null,
      can_bypass_rls: false,
      config: null,
      comment: null,
      members: [],
      default_privileges: [],
    });

    const change = new DropRole({
      role,
    });

    await assertValidSql(change.serialize());

    expect(change.serialize()).toBe("DROP ROLE test_role");
  });
});
