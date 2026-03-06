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

  test("create role skips self-granted membership (member === grantor)", () => {
    // Simulates the auto-created membership when postgres creates a role:
    // PostgreSQL automatically makes the creator a member with grantor=self.
    const role = new Role({
      ...base,
      name: "developer",
      members: [
        {
          member: "postgres",
          grantor: "postgres",
          admin_option: true,
          inherit_option: true,
          set_option: true,
        },
      ],
    });
    const changes = diffRoles(
      { version: 170000 },
      {},
      { [role.stableId]: role },
    );
    // Should only have CreateRole, no GrantRoleMembership for postgres
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(CreateRole);
  });

  test("create role keeps membership when member differs from grantor", () => {
    const role = new Role({
      ...base,
      name: "developer",
      members: [
        {
          member: "app_user",
          grantor: "postgres",
          admin_option: true,
          inherit_option: true,
          set_option: true,
        },
      ],
    });
    const changes = diffRoles(
      { version: 170000 },
      {},
      { [role.stableId]: role },
    );
    // Should have CreateRole + GrantRoleMembership
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(CreateRole);
    expect(changes[1]).toBeInstanceOf(GrantRoleMembership);
  });

  test("create role deduplicates memberships from multiple grantors", () => {
    // PG 16+ can have multiple pg_auth_members rows for the same member
    // with different grantors.
    const role = new Role({
      ...base,
      name: "developer",
      members: [
        {
          member: "app_user",
          grantor: "postgres",
          admin_option: false,
          inherit_option: true,
          set_option: true,
        },
        {
          member: "app_user",
          grantor: "supabase_admin",
          admin_option: true,
          inherit_option: true,
          set_option: true,
        },
      ],
    });
    const changes = diffRoles(
      { version: 170000 },
      {},
      { [role.stableId]: role },
    );
    // Should have CreateRole + exactly ONE GrantRoleMembership with admin=true
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(CreateRole);
    const grant = changes[1] as GrantRoleMembership;
    expect(grant).toBeInstanceOf(GrantRoleMembership);
    expect(grant.options.admin).toBe(true);
  });

  test("create role skips self-granted membership even with multiple grantors all being the member", () => {
    const role = new Role({
      ...base,
      name: "developer",
      members: [
        {
          member: "postgres",
          grantor: "postgres",
          admin_option: false,
          inherit_option: true,
          set_option: true,
        },
        {
          member: "postgres",
          grantor: "postgres",
          admin_option: true,
          inherit_option: true,
          set_option: true,
        },
      ],
    });
    const changes = diffRoles(
      { version: 170000 },
      {},
      { [role.stableId]: role },
    );
    // All grantors are the member itself, should skip
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(CreateRole);
  });

  test("create role keeps mixed-grantor membership where not all grantors equal member", () => {
    const role = new Role({
      ...base,
      name: "developer",
      members: [
        {
          member: "postgres",
          grantor: "postgres",
          admin_option: false,
          inherit_option: true,
          set_option: true,
        },
        {
          member: "postgres",
          grantor: "supabase_admin",
          admin_option: true,
          inherit_option: true,
          set_option: true,
        },
      ],
    });
    const changes = diffRoles(
      { version: 170000 },
      {},
      { [role.stableId]: role },
    );
    // One grantor is different from member, so the membership should be kept
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(CreateRole);
    expect(changes[1]).toBeInstanceOf(GrantRoleMembership);
  });

  test("alter role skips granting admin to self-granted membership", () => {
    const mainRole = new Role({
      ...base,
      name: "developer",
      members: [
        {
          member: "postgres",
          grantor: "postgres",
          admin_option: false,
          inherit_option: true,
          set_option: true,
        },
      ],
    });
    const branchRole = new Role({
      ...base,
      name: "developer",
      members: [
        {
          member: "postgres",
          grantor: "postgres",
          admin_option: true,
          inherit_option: true,
          set_option: true,
        },
      ],
    });
    const changes = diffRoles(
      { version: 170000 },
      { [mainRole.stableId]: mainRole },
      { [branchRole.stableId]: branchRole },
    );
    // Should produce no changes — granting admin back to self would fail
    expect(changes).toHaveLength(0);
  });
});
