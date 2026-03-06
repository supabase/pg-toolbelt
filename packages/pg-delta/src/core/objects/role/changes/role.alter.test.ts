import { describe, expect, test } from "bun:test";
import { Role, type RoleProps } from "../role.model.ts";
import { AlterRoleSetOptions } from "./role.alter.ts";
import { assertValidSql } from "../../../test-utils/assert-valid-sql.ts";

describe.concurrent("role", () => {
  describe("alter", () => {
    test("alter SUPERUSER", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["SUPERUSER"] });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH SUPERUSER");
    });

    test("alter NOSUPERUSER", async () => {
      const role = new Role({
        name: "r",
        is_superuser: true,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["NOSUPERUSER"],
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOSUPERUSER");
    });

    test("alter NOCREATEDB", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: true,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["NOCREATEDB"] });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOCREATEDB");
    });

    test("alter NOCREATEROLE", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: true,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["NOCREATEROLE"],
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOCREATEROLE");
    });

    test("alter INHERIT", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: false,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["INHERIT"] });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH INHERIT");
    });

    test("alter LOGIN", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["LOGIN"] });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH LOGIN");
    });

    test("alter NOREPLICATION", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: true,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["NOREPLICATION"],
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOREPLICATION");
    });

    test("alter NOBYPASSRLS", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: true,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["NOBYPASSRLS"],
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOBYPASSRLS");
    });

    test("alter CREATEROLE", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["CREATEROLE"] });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH CREATEROLE");
    });

    test("alter NOINHERIT", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["NOINHERIT"] });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOINHERIT");
    });

    test("alter NOLOGIN", async () => {
      const role = new Role({
        name: "r",
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
      const change = new AlterRoleSetOptions({ role, options: ["NOLOGIN"] });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH NOLOGIN");
    });

    test("alter REPLICATION", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["REPLICATION"],
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH REPLICATION");
    });

    test("alter BYPASSRLS", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({ role, options: ["BYPASSRLS"] });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe("ALTER ROLE r WITH BYPASSRLS");
    });

    test("alter multiple options ordering", async () => {
      const role = new Role({
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_create_databases: false,
        can_login: false,
        can_replicate: false,
        connection_limit: null,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      });
      const change = new AlterRoleSetOptions({
        role,
        options: [
          "SUPERUSER",
          "CREATEDB",
          "CREATEROLE",
          "NOINHERIT",
          "LOGIN",
          "REPLICATION",
          "BYPASSRLS",
          "CONNECTION LIMIT 10",
        ],
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER ROLE r WITH SUPERUSER CREATEDB CREATEROLE NOINHERIT LOGIN REPLICATION BYPASSRLS CONNECTION LIMIT 10",
      );
    });
    test("alter flags and connection limit", async () => {
      const props: Omit<
        RoleProps,
        "can_create_databases" | "connection_limit"
      > = {
        name: "r",
        is_superuser: false,
        can_inherit: true,
        can_create_roles: false,
        can_login: false,
        can_replicate: false,
        can_bypass_rls: false,
        config: null,
        comment: null,
        members: [],
        default_privileges: [],
      };
      const role = new Role({
        ...props,
        can_create_databases: false,
        connection_limit: null,
      });
      const change = new AlterRoleSetOptions({
        role,
        options: ["CREATEDB", "CONNECTION LIMIT 3"],
      });
      await assertValidSql(change.serialize());
      expect(change.serialize()).toBe(
        "ALTER ROLE r WITH CREATEDB CONNECTION LIMIT 3",
      );
    });
  });
});
