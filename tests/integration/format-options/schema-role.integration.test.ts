import { describe, expect, test } from "vitest";
import {
  type ChangeCase,
  formatCases,
  pgVersion,
  priv,
  renderChanges,
  role,
  schema,
} from "./fixtures.ts";
import { AlterSchemaChangeOwner } from "../../../src/core/objects/schema/changes/schema.alter.ts";
import { CreateSchema } from "../../../src/core/objects/schema/changes/schema.create.ts";
import {
  CreateCommentOnSchema,
  DropCommentOnSchema,
} from "../../../src/core/objects/schema/changes/schema.comment.ts";
import { DropSchema } from "../../../src/core/objects/schema/changes/schema.drop.ts";
import {
  GrantSchemaPrivileges,
  RevokeGrantOptionSchemaPrivileges,
  RevokeSchemaPrivileges,
} from "../../../src/core/objects/schema/changes/schema.privilege.ts";
import {
  AlterRoleSetConfig,
  AlterRoleSetOptions,
} from "../../../src/core/objects/role/changes/role.alter.ts";
import { CreateRole } from "../../../src/core/objects/role/changes/role.create.ts";
import {
  CreateCommentOnRole,
  DropCommentOnRole,
} from "../../../src/core/objects/role/changes/role.comment.ts";
import { DropRole } from "../../../src/core/objects/role/changes/role.drop.ts";
import {
  GrantRoleDefaultPrivileges,
  GrantRoleMembership,
  RevokeRoleDefaultPrivileges,
  RevokeRoleMembership,
  RevokeRoleMembershipOptions,
} from "../../../src/core/objects/role/changes/role.privilege.ts";

const changes: ChangeCase[] = [
  { label: "schema.create", change: new CreateSchema({ schema }) },
  {
    label: "schema.alter.owner",
    change: new AlterSchemaChangeOwner({ schema, owner: "owner2" }),
  },
  {
    label: "schema.comment.create",
    change: new CreateCommentOnSchema({ schema }),
  },
  { label: "schema.comment.drop", change: new DropCommentOnSchema({ schema }) },
  {
    label: "schema.privilege.grant",
    change: new GrantSchemaPrivileges({
      schema,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "schema.privilege.revoke",
    change: new RevokeSchemaPrivileges({
      schema,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "schema.privilege.revoke_grant_option",
    change: new RevokeGrantOptionSchemaPrivileges({
      schema,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "schema.drop", change: new DropSchema({ schema }) },

  { label: "role.create", change: new CreateRole({ role }) },
  {
    label: "role.alter.options",
    change: new AlterRoleSetOptions({
      role,
      options: ["NOSUPERUSER", "NOCREATEDB", "NOINHERIT"],
    }),
  },
  {
    label: "role.alter.config.set",
    change: new AlterRoleSetConfig({
      role,
      action: "set",
      key: "search_path",
      value: "public",
    }),
  },
  {
    label: "role.alter.config.reset",
    change: new AlterRoleSetConfig({
      role,
      action: "reset",
      key: "search_path",
    }),
  },
  {
    label: "role.alter.config.reset_all",
    change: new AlterRoleSetConfig({ role, action: "reset_all" }),
  },
  { label: "role.comment.create", change: new CreateCommentOnRole({ role }) },
  { label: "role.comment.drop", change: new DropCommentOnRole({ role }) },
  {
    label: "role.privilege.membership.grant",
    change: new GrantRoleMembership({
      role,
      member: "member1",
      options: { admin: true },
    }),
  },
  {
    label: "role.privilege.membership.revoke",
    change: new RevokeRoleMembership({ role, member: "member1" }),
  },
  {
    label: "role.privilege.membership.revoke_options",
    change: new RevokeRoleMembershipOptions({
      role,
      member: "member1",
      admin: true,
    }),
  },
  {
    label: "role.privilege.default.grant",
    change: new GrantRoleDefaultPrivileges({
      role,
      inSchema: "public",
      objtype: "r",
      grantee: "app_user",
      privileges: [priv("SELECT")],
      version: pgVersion,
    }),
  },
  {
    label: "role.privilege.default.revoke",
    change: new RevokeRoleDefaultPrivileges({
      role,
      inSchema: "public",
      objtype: "r",
      grantee: "app_user",
      privileges: [priv("SELECT")],
      version: pgVersion,
    }),
  },
  { label: "role.drop", change: new DropRole({ role }) },
];

describe("format options: schema + role", () => {
  const [formatOff, formatPrettyUpper, formatPrettyLowerLeading, formatPrettyNarrow, formatPrettyPreserve] =
    formatCases;

  test(formatOff.header, () => {
    const output = `${formatOff.header}\n\n${renderChanges(
      changes,
      formatOff.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: off

      -- schema.create
      CREATE SCHEMA app AUTHORIZATION owner1

      -- schema.alter.owner
      ALTER SCHEMA app OWNER TO owner2

      -- schema.comment.create
      COMMENT ON SCHEMA app IS 'app schema'

      -- schema.comment.drop
      COMMENT ON SCHEMA app IS NULL

      -- schema.privilege.grant
      GRANT USAGE ON SCHEMA app TO app_user

      -- schema.privilege.revoke
      REVOKE USAGE ON SCHEMA app FROM app_user

      -- schema.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE ON SCHEMA app FROM app_user

      -- schema.drop
      DROP SCHEMA app

      -- role.create
      CREATE ROLE role_main WITH SUPERUSER CREATEDB CREATEROLE NOINHERIT LOGIN REPLICATION BYPASSRLS CONNECTION LIMIT 5

      -- role.alter.options
      ALTER ROLE role_main WITH NOSUPERUSER NOCREATEDB NOINHERIT

      -- role.alter.config.set
      ALTER ROLE role_main SET search_path TO public

      -- role.alter.config.reset
      ALTER ROLE role_main RESET search_path

      -- role.alter.config.reset_all
      ALTER ROLE role_main RESET ALL

      -- role.comment.create
      COMMENT ON ROLE role_main IS 'role comment'

      -- role.comment.drop
      COMMENT ON ROLE role_main IS NULL

      -- role.privilege.membership.grant
      GRANT role_main TO member1 WITH ADMIN OPTION

      -- role.privilege.membership.revoke
      REVOKE role_main FROM member1

      -- role.privilege.membership.revoke_options
      REVOKE ADMIN OPTION FOR role_main FROM member1

      -- role.privilege.default.grant
      ALTER DEFAULT PRIVILEGES FOR ROLE role_main IN SCHEMA public GRANT SELECT ON TABLES TO app_user

      -- role.privilege.default.revoke
      ALTER DEFAULT PRIVILEGES FOR ROLE role_main IN SCHEMA public REVOKE SELECT ON TABLES FROM app_user

      -- role.drop
      DROP ROLE role_main"
    `);
  });

  test(formatPrettyUpper.header, () => {
    const output = `${formatPrettyUpper.header}\n\n${renderChanges(
      changes,
      formatPrettyUpper.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true }

      -- schema.create
      CREATE SCHEMA app
      AUTHORIZATION owner1

      -- schema.alter.owner
      ALTER SCHEMA app OWNER TO owner2

      -- schema.comment.create
      COMMENT ON SCHEMA app IS 'app schema'

      -- schema.comment.drop
      COMMENT ON SCHEMA app IS NULL

      -- schema.privilege.grant
      GRANT USAGE ON SCHEMA app TO app_user

      -- schema.privilege.revoke
      REVOKE USAGE ON SCHEMA app FROM app_user

      -- schema.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE ON SCHEMA app FROM app_user

      -- schema.drop
      DROP SCHEMA app

      -- role.create
      CREATE ROLE role_main
      WITH
        SUPERUSER
        CREATEDB
        CREATEROLE
        NOINHERIT
        LOGIN
        REPLICATION
        BYPASSRLS
        CONNECTION LIMIT 5

      -- role.alter.options
      ALTER ROLE role_main WITH NOSUPERUSER NOCREATEDB NOINHERIT

      -- role.alter.config.set
      ALTER ROLE role_main SET search_path TO public

      -- role.alter.config.reset
      ALTER ROLE role_main RESET search_path

      -- role.alter.config.reset_all
      ALTER ROLE role_main RESET ALL

      -- role.comment.create
      COMMENT ON ROLE role_main IS 'role comment'

      -- role.comment.drop
      COMMENT ON ROLE role_main IS NULL

      -- role.privilege.membership.grant
      GRANT role_main TO member1 WITH ADMIN OPTION

      -- role.privilege.membership.revoke
      REVOKE role_main FROM member1

      -- role.privilege.membership.revoke_options
      REVOKE ADMIN OPTION FOR role_main FROM member1

      -- role.privilege.default.grant
      ALTER DEFAULT PRIVILEGES FOR ROLE role_main IN SCHEMA public GRANT SELECT ON TABLES TO app_user

      -- role.privilege.default.revoke
      ALTER DEFAULT PRIVILEGES FOR ROLE role_main IN SCHEMA public REVOKE SELECT ON TABLES FROM app_user

      -- role.drop
      DROP ROLE role_main"
    `);
  });

  test(formatPrettyLowerLeading.header, () => {
    const output = `${formatPrettyLowerLeading.header}\n\n${renderChanges(
      changes,
      formatPrettyLowerLeading.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }

      -- schema.create
      create schema app
      authorization owner1

      -- schema.alter.owner
      alter schema app owner to owner2

      -- schema.comment.create
      comment on schema app is 'app schema'

      -- schema.comment.drop
      comment on schema app is null

      -- schema.privilege.grant
      grant usage on schema app to app_user

      -- schema.privilege.revoke
      revoke usage on schema app from app_user

      -- schema.privilege.revoke_grant_option
      revoke grant option for usage on schema app from app_user

      -- schema.drop
      drop schema app

      -- role.create
      create role role_main
      with
          superuser
          createdb
          createrole
          noinherit
          login
          replication
          bypassrls
          connection limit 5

      -- role.alter.options
      alter role role_main with NOSUPERUSER NOCREATEDB NOINHERIT

      -- role.alter.config.set
      alter role role_main set search_path to public

      -- role.alter.config.reset
      alter role role_main reset search_path

      -- role.alter.config.reset_all
      alter role role_main reset all

      -- role.comment.create
      comment on role role_main is 'role comment'

      -- role.comment.drop
      comment on role role_main is null

      -- role.privilege.membership.grant
      grant role_main to member1 with admin option

      -- role.privilege.membership.revoke
      revoke role_main from member1

      -- role.privilege.membership.revoke_options
      revoke admin option for role_main from member1

      -- role.privilege.default.grant
      alter default privileges for role role_main in schema public grant SELECT on tables to app_user

      -- role.privilege.default.revoke
      alter default privileges for role role_main in schema public revoke SELECT on tables from app_user

      -- role.drop
      drop role role_main"
    `);
  });

  test(formatPrettyNarrow.header, () => {
    const output = `${formatPrettyNarrow.header}\n\n${renderChanges(
      changes,
      formatPrettyNarrow.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, lineWidth: 40 }

      -- schema.create
      CREATE SCHEMA app
      AUTHORIZATION owner1

      -- schema.alter.owner
      ALTER SCHEMA app OWNER TO owner2

      -- schema.comment.create
      COMMENT ON SCHEMA app IS 'app schema'

      -- schema.comment.drop
      COMMENT ON SCHEMA app IS NULL

      -- schema.privilege.grant
      GRANT USAGE ON SCHEMA app TO app_user

      -- schema.privilege.revoke
      REVOKE USAGE ON SCHEMA app FROM app_user

      -- schema.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE ON SCHEMA
        app FROM app_user

      -- schema.drop
      DROP SCHEMA app

      -- role.create
      CREATE ROLE role_main
      WITH
        SUPERUSER
        CREATEDB
        CREATEROLE
        NOINHERIT
        LOGIN
        REPLICATION
        BYPASSRLS
        CONNECTION LIMIT 5

      -- role.alter.options
      ALTER ROLE role_main WITH NOSUPERUSER
        NOCREATEDB NOINHERIT

      -- role.alter.config.set
      ALTER ROLE role_main SET search_path TO
        public

      -- role.alter.config.reset
      ALTER ROLE role_main RESET search_path

      -- role.alter.config.reset_all
      ALTER ROLE role_main RESET ALL

      -- role.comment.create
      COMMENT ON ROLE role_main IS 'role
        comment'

      -- role.comment.drop
      COMMENT ON ROLE role_main IS NULL

      -- role.privilege.membership.grant
      GRANT role_main TO member1 WITH ADMIN
        OPTION

      -- role.privilege.membership.revoke
      REVOKE role_main FROM member1

      -- role.privilege.membership.revoke_options
      REVOKE ADMIN OPTION FOR role_main FROM
        member1

      -- role.privilege.default.grant
      ALTER DEFAULT PRIVILEGES FOR ROLE
        role_main IN SCHEMA public GRANT
          SELECT ON TABLES TO app_user

      -- role.privilege.default.revoke
      ALTER DEFAULT PRIVILEGES FOR ROLE
        role_main IN SCHEMA public REVOKE
          SELECT ON TABLES FROM app_user

      -- role.drop
      DROP ROLE role_main"
    `);
  });

  test(formatPrettyPreserve.header, () => {
    const output = `${formatPrettyPreserve.header}\n\n${renderChanges(
      changes,
      formatPrettyPreserve.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }

      -- schema.create
      CREATE SCHEMA app
      AUTHORIZATION owner1

      -- schema.alter.owner
      ALTER SCHEMA app OWNER TO owner2

      -- schema.comment.create
      COMMENT ON SCHEMA app IS 'app schema'

      -- schema.comment.drop
      COMMENT ON SCHEMA app IS NULL

      -- schema.privilege.grant
      GRANT USAGE ON SCHEMA app TO app_user

      -- schema.privilege.revoke
      REVOKE USAGE ON SCHEMA app FROM app_user

      -- schema.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE ON SCHEMA app FROM app_user

      -- schema.drop
      DROP SCHEMA app

      -- role.create
      CREATE ROLE role_main
      WITH
         SUPERUSER
         CREATEDB
         CREATEROLE
         NOINHERIT
         LOGIN
         REPLICATION
         BYPASSRLS
         CONNECTION LIMIT 5

      -- role.alter.options
      ALTER ROLE role_main WITH NOSUPERUSER NOCREATEDB NOINHERIT

      -- role.alter.config.set
      ALTER ROLE role_main SET search_path TO public

      -- role.alter.config.reset
      ALTER ROLE role_main RESET search_path

      -- role.alter.config.reset_all
      ALTER ROLE role_main RESET ALL

      -- role.comment.create
      COMMENT ON ROLE role_main IS 'role comment'

      -- role.comment.drop
      COMMENT ON ROLE role_main IS NULL

      -- role.privilege.membership.grant
      GRANT role_main TO member1 WITH ADMIN OPTION

      -- role.privilege.membership.revoke
      REVOKE role_main FROM member1

      -- role.privilege.membership.revoke_options
      REVOKE ADMIN OPTION FOR role_main FROM member1

      -- role.privilege.default.grant
      ALTER DEFAULT PRIVILEGES FOR ROLE role_main IN SCHEMA public GRANT SELECT ON TABLES TO app_user

      -- role.privilege.default.revoke
      ALTER DEFAULT PRIVILEGES FOR ROLE role_main IN SCHEMA public REVOKE SELECT ON TABLES FROM app_user

      -- role.drop
      DROP ROLE role_main"
    `);
  });
});
