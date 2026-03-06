import { describe, expect, test } from "bun:test";
import { AlterRoleSetOptions } from "./changes/role.alter.ts";
import { CreateRole } from "./changes/role.create.ts";
import { DropRole } from "./changes/role.drop.ts";
import { GrantRoleMembership } from "./changes/role.privilege.ts";
import { diffRoles } from "./role.diff.ts";
import { Role, type RoleProps } from "./role.model.ts";

const base: RoleProps = {
  name: "r1",
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
};

describe.concurrent("role.diff", () => {
  test("create and drop", () => {
    const r = new Role(base);
    const created = diffRoles({ version: 170000 }, {}, { [r.stableId]: r });
    expect(created[0]).toBeInstanceOf(CreateRole);

    const dropped = diffRoles({ version: 170000 }, { [r.stableId]: r }, {});
    expect(dropped[0]).toBeInstanceOf(DropRole);
  });

  test("alter on flag change", () => {
    const main = new Role(base);
    const branch = new Role({ ...base, can_login: false });
    const changes = diffRoles(
      { version: 170000 },
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterRoleSetOptions);
  });

  test("no duplicate membership grants when members have multiple grantors", () => {
    // In PG 16+, pg_auth_members can have multiple rows for the same
    // (roleid, member) pair with different grantors. The Role constructor
    // should deduplicate these so diffRoles doesn't emit duplicate changes.
    const parentRole = new Role({
      ...base,
      name: "postgres",
      members: [
        {
          member: "cli_login_postgres",
          grantor: "postgres",
          admin_option: false,
          inherit_option: false,
          set_option: false,
        },
        {
          member: "cli_login_postgres",
          grantor: "supabase_admin",
          admin_option: false,
          inherit_option: false,
          set_option: false,
        },
      ],
    });

    // After deduplication, should have only one member entry
    expect(parentRole.members).toHaveLength(1);
    expect(parentRole.members[0].member).toBe("cli_login_postgres");

    // When diffing, the created role should emit only one GRANT
    const changes = diffRoles(
      { version: 170000 },
      {},
      { [parentRole.stableId]: parentRole },
    );
    const grantChanges = changes.filter(
      (c) => c instanceof GrantRoleMembership,
    );
    expect(grantChanges).toHaveLength(1);
  });

  test("duplicate members are merged with most permissive options", () => {
    const role = new Role({
      ...base,
      name: "test_role",
      members: [
        {
          member: "member1",
          grantor: "grantor_a",
          admin_option: false,
          inherit_option: false,
          set_option: true,
        },
        {
          member: "member1",
          grantor: "grantor_b",
          admin_option: true,
          inherit_option: false,
          set_option: false,
        },
      ],
    });

    expect(role.members).toHaveLength(1);
    expect(role.members[0].admin_option).toBe(true);
    expect(role.members[0].set_option).toBe(true);
  });

  test("no false alter when both sides have duplicate members from different grantors", () => {
    // Both main and branch have the same membership but from different
    // grantors. After deduplication the roles should be equal, producing
    // no changes.
    const main = new Role({
      ...base,
      name: "parent",
      members: [
        {
          member: "child",
          grantor: "postgres",
          admin_option: false,
          inherit_option: false,
          set_option: false,
        },
        {
          member: "child",
          grantor: "supabase_admin",
          admin_option: false,
          inherit_option: false,
          set_option: false,
        },
      ],
    });
    const branch = new Role({
      ...base,
      name: "parent",
      members: [
        {
          member: "child",
          grantor: "another_admin",
          admin_option: false,
          inherit_option: false,
          set_option: false,
        },
      ],
    });

    const changes = diffRoles(
      { version: 170000 },
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(0);
  });
});
