import { describe, expect, test } from "vitest";
import {
  type ChangeCase,
  column,
  foreignDataWrapper,
  foreignTable,
  formatCases,
  pgVersion,
  priv,
  renderChanges,
  server,
  userMapping,
} from "./fixtures.ts";
import { CreateForeignDataWrapper } from "../../../src/core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.create.ts";
import {
  AlterForeignDataWrapperChangeOwner,
  AlterForeignDataWrapperSetOptions,
} from "../../../src/core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.alter.ts";
import {
  CreateCommentOnForeignDataWrapper,
  DropCommentOnForeignDataWrapper,
} from "../../../src/core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.comment.ts";
import { DropForeignDataWrapper } from "../../../src/core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.drop.ts";
import {
  GrantForeignDataWrapperPrivileges,
  RevokeForeignDataWrapperPrivileges,
  RevokeGrantOptionForeignDataWrapperPrivileges,
} from "../../../src/core/objects/foreign-data-wrapper/foreign-data-wrapper/changes/foreign-data-wrapper.privilege.ts";
import { CreateServer } from "../../../src/core/objects/foreign-data-wrapper/server/changes/server.create.ts";
import {
  AlterServerChangeOwner,
  AlterServerSetOptions,
  AlterServerSetVersion,
} from "../../../src/core/objects/foreign-data-wrapper/server/changes/server.alter.ts";
import {
  CreateCommentOnServer,
  DropCommentOnServer,
} from "../../../src/core/objects/foreign-data-wrapper/server/changes/server.comment.ts";
import { DropServer } from "../../../src/core/objects/foreign-data-wrapper/server/changes/server.drop.ts";
import {
  GrantServerPrivileges,
  RevokeServerPrivileges,
  RevokeGrantOptionServerPrivileges,
} from "../../../src/core/objects/foreign-data-wrapper/server/changes/server.privilege.ts";
import { CreateForeignTable } from "../../../src/core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.create.ts";
import {
  AlterForeignTableAddColumn,
  AlterForeignTableAlterColumnDropDefault,
  AlterForeignTableAlterColumnDropNotNull,
  AlterForeignTableAlterColumnSetDefault,
  AlterForeignTableAlterColumnSetNotNull,
  AlterForeignTableAlterColumnType,
  AlterForeignTableChangeOwner,
  AlterForeignTableDropColumn,
  AlterForeignTableSetOptions,
} from "../../../src/core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.alter.ts";
import {
  CreateCommentOnForeignTable,
  DropCommentOnForeignTable,
} from "../../../src/core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.comment.ts";
import { DropForeignTable } from "../../../src/core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.drop.ts";
import {
  GrantForeignTablePrivileges,
  RevokeForeignTablePrivileges,
  RevokeGrantOptionForeignTablePrivileges,
} from "../../../src/core/objects/foreign-data-wrapper/foreign-table/changes/foreign-table.privilege.ts";
import { CreateUserMapping } from "../../../src/core/objects/foreign-data-wrapper/user-mapping/changes/user-mapping.create.ts";
import { AlterUserMappingSetOptions } from "../../../src/core/objects/foreign-data-wrapper/user-mapping/changes/user-mapping.alter.ts";
import { DropUserMapping } from "../../../src/core/objects/foreign-data-wrapper/user-mapping/changes/user-mapping.drop.ts";

const changes: ChangeCase[] = [
  {
    label: "fdw.create",
    change: new CreateForeignDataWrapper({ foreignDataWrapper }),
  },
  {
    label: "fdw.alter.owner",
    change: new AlterForeignDataWrapperChangeOwner({
      foreignDataWrapper,
      owner: "owner2",
    }),
  },
  {
    label: "fdw.alter.options",
    change: new AlterForeignDataWrapperSetOptions({
      foreignDataWrapper,
      options: [
        { action: "SET", option: "host", value: "db.example.com" },
        { action: "DROP", option: "port" },
      ],
    }),
  },
  {
    label: "fdw.comment.create",
    change: new CreateCommentOnForeignDataWrapper({ foreignDataWrapper }),
  },
  {
    label: "fdw.comment.drop",
    change: new DropCommentOnForeignDataWrapper({ foreignDataWrapper }),
  },
  {
    label: "fdw.privilege.grant",
    change: new GrantForeignDataWrapperPrivileges({
      foreignDataWrapper,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "fdw.privilege.revoke",
    change: new RevokeForeignDataWrapperPrivileges({
      foreignDataWrapper,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "fdw.privilege.revoke_grant_option",
    change: new RevokeGrantOptionForeignDataWrapperPrivileges({
      foreignDataWrapper,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "fdw.drop", change: new DropForeignDataWrapper({ foreignDataWrapper }) },

  { label: "server.create", change: new CreateServer({ server }) },
  {
    label: "server.alter.owner",
    change: new AlterServerChangeOwner({ server, owner: "owner2" }),
  },
  {
    label: "server.alter.version",
    change: new AlterServerSetVersion({ server, version: "2.0" }),
  },
  {
    label: "server.alter.options",
    change: new AlterServerSetOptions({
      server,
      options: [
        { action: "ADD", option: "updatable", value: "true" },
        { action: "DROP", option: "port" },
      ],
    }),
  },
  { label: "server.comment.create", change: new CreateCommentOnServer({ server }) },
  { label: "server.comment.drop", change: new DropCommentOnServer({ server }) },
  {
    label: "server.privilege.grant",
    change: new GrantServerPrivileges({
      server,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "server.privilege.revoke",
    change: new RevokeServerPrivileges({
      server,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "server.privilege.revoke_grant_option",
    change: new RevokeGrantOptionServerPrivileges({
      server,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "server.drop", change: new DropServer({ server }) },

  { label: "foreign_table.create", change: new CreateForeignTable({ foreignTable }) },
  {
    label: "foreign_table.alter.owner",
    change: new AlterForeignTableChangeOwner({
      foreignTable,
      owner: "owner2",
    }),
  },
  {
    label: "foreign_table.alter.add_column",
    change: new AlterForeignTableAddColumn({
      foreignTable,
      column: column({ name: "extra", data_type_str: "text" }),
    }),
  },
  {
    label: "foreign_table.alter.drop_column",
    change: new AlterForeignTableDropColumn({
      foreignTable,
      columnName: "name",
    }),
  },
  {
    label: "foreign_table.alter.column_type",
    change: new AlterForeignTableAlterColumnType({
      foreignTable,
      columnName: "name",
      dataType: "varchar(120)",
    }),
  },
  {
    label: "foreign_table.alter.column_set_default",
    change: new AlterForeignTableAlterColumnSetDefault({
      foreignTable,
      columnName: "name",
      defaultValue: "'unknown'",
    }),
  },
  {
    label: "foreign_table.alter.column_drop_default",
    change: new AlterForeignTableAlterColumnDropDefault({
      foreignTable,
      columnName: "name",
    }),
  },
  {
    label: "foreign_table.alter.column_set_not_null",
    change: new AlterForeignTableAlterColumnSetNotNull({
      foreignTable,
      columnName: "name",
    }),
  },
  {
    label: "foreign_table.alter.column_drop_not_null",
    change: new AlterForeignTableAlterColumnDropNotNull({
      foreignTable,
      columnName: "name",
    }),
  },
  {
    label: "foreign_table.alter.options",
    change: new AlterForeignTableSetOptions({
      foreignTable,
      options: [
        { action: "SET", option: "schema_name", value: "remote" },
        { action: "DROP", option: "table_name" },
      ],
    }),
  },
  {
    label: "foreign_table.comment.create",
    change: new CreateCommentOnForeignTable({ foreignTable }),
  },
  {
    label: "foreign_table.comment.drop",
    change: new DropCommentOnForeignTable({ foreignTable }),
  },
  {
    label: "foreign_table.privilege.grant",
    change: new GrantForeignTablePrivileges({
      foreignTable,
      grantee: "app_user",
      privileges: [priv("SELECT")],
      version: pgVersion,
    }),
  },
  {
    label: "foreign_table.privilege.revoke",
    change: new RevokeForeignTablePrivileges({
      foreignTable,
      grantee: "app_user",
      privileges: [priv("SELECT")],
      version: pgVersion,
    }),
  },
  {
    label: "foreign_table.privilege.revoke_grant_option",
    change: new RevokeGrantOptionForeignTablePrivileges({
      foreignTable,
      grantee: "app_user",
      privilegeNames: ["SELECT"],
      version: pgVersion,
    }),
  },
  { label: "foreign_table.drop", change: new DropForeignTable({ foreignTable }) },

  { label: "user_mapping.create", change: new CreateUserMapping({ userMapping }) },
  {
    label: "user_mapping.alter.options",
    change: new AlterUserMappingSetOptions({
      userMapping,
      options: [
        { action: "SET", option: "user", value: "remote_user" },
        { action: "DROP", option: "password" },
      ],
    }),
  },
  { label: "user_mapping.drop", change: new DropUserMapping({ userMapping }) },
];

describe("format options: foreign data wrapper + server + foreign table + user mapping", () => {
  const [formatOff, formatPrettyUpper, formatPrettyLowerLeading, formatPrettyNarrow, formatPrettyPreserve] =
    formatCases;

  test(formatOff.header, () => {
    const output = `${formatOff.header}\n\n${renderChanges(
      changes,
      formatOff.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: off

      -- fdw.create
      CREATE FOREIGN DATA WRAPPER test_fdw HANDLER public.handler_func() VALIDATOR public.validator_func() OPTIONS (host 'localhost', port '5432')

      -- fdw.alter.owner
      ALTER FOREIGN DATA WRAPPER test_fdw OWNER TO owner2

      -- fdw.alter.options
      ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (SET host 'db.example.com', DROP port)

      -- fdw.comment.create
      COMMENT ON FOREIGN DATA WRAPPER test_fdw IS 'fdw comment'

      -- fdw.comment.drop
      COMMENT ON FOREIGN DATA WRAPPER test_fdw IS NULL

      -- fdw.privilege.grant
      GRANT ALL ON FOREIGN DATA WRAPPER test_fdw TO app_user

      -- fdw.privilege.revoke
      REVOKE ALL ON FOREIGN DATA WRAPPER test_fdw FROM app_user

      -- fdw.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FOREIGN DATA WRAPPER test_fdw FROM app_user

      -- fdw.drop
      DROP FOREIGN DATA WRAPPER test_fdw

      -- server.create
      CREATE SERVER test_server VERSION '1.0' FOREIGN DATA WRAPPER test_fdw OPTIONS (host 'localhost', port '5432')

      -- server.alter.owner
      ALTER SERVER test_server OWNER TO owner2

      -- server.alter.version
      ALTER SERVER test_server VERSION '2.0'

      -- server.alter.options
      ALTER SERVER test_server OPTIONS (ADD updatable 'true', DROP port)

      -- server.comment.create
      COMMENT ON SERVER test_server IS 'server comment'

      -- server.comment.drop
      COMMENT ON SERVER test_server IS NULL

      -- server.privilege.grant
      GRANT ALL ON SERVER test_server TO app_user

      -- server.privilege.revoke
      REVOKE ALL ON SERVER test_server FROM app_user

      -- server.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON SERVER test_server FROM app_user

      -- server.drop
      DROP SERVER test_server

      -- foreign_table.create
      CREATE FOREIGN TABLE public.test_table (id integer, name text) SERVER test_server OPTIONS (schema_name 'remote_schema', table_name 'remote_table')

      -- foreign_table.alter.owner
      ALTER FOREIGN TABLE public.test_table OWNER TO owner2

      -- foreign_table.alter.add_column
      ALTER FOREIGN TABLE public.test_table ADD COLUMN extra text

      -- foreign_table.alter.drop_column
      ALTER FOREIGN TABLE public.test_table DROP COLUMN name

      -- foreign_table.alter.column_type
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name TYPE varchar(120)

      -- foreign_table.alter.column_set_default
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name SET DEFAULT 'unknown'

      -- foreign_table.alter.column_drop_default
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name DROP DEFAULT

      -- foreign_table.alter.column_set_not_null
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name SET NOT NULL

      -- foreign_table.alter.column_drop_not_null
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name DROP NOT NULL

      -- foreign_table.alter.options
      ALTER FOREIGN TABLE public.test_table OPTIONS (SET schema_name 'remote', DROP table_name)

      -- foreign_table.comment.create
      COMMENT ON FOREIGN TABLE public.test_table IS 'foreign table comment'

      -- foreign_table.comment.drop
      COMMENT ON FOREIGN TABLE public.test_table IS NULL

      -- foreign_table.privilege.grant
      GRANT SELECT ON FOREIGN TABLE public.test_table TO app_user

      -- foreign_table.privilege.revoke
      REVOKE SELECT ON FOREIGN TABLE public.test_table FROM app_user

      -- foreign_table.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT ON FOREIGN TABLE public.test_table FROM app_user

      -- foreign_table.drop
      DROP FOREIGN TABLE public.test_table

      -- user_mapping.create
      CREATE USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (user 'remote_user', password 'secret')

      -- user_mapping.alter.options
      ALTER USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (SET user 'remote_user', DROP password)

      -- user_mapping.drop
      DROP USER MAPPING FOR PUBLIC SERVER test_server"
    `);
  });

  test(formatPrettyUpper.header, () => {
    const output = `${formatPrettyUpper.header}\n\n${renderChanges(
      changes,
      formatPrettyUpper.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true }

      -- fdw.create
      CREATE FOREIGN DATA WRAPPER test_fdw
      HANDLER public.handler_func()
      VALIDATOR public.validator_func()
      OPTIONS (
        host 'localhost',
        port '5432'
      )

      -- fdw.alter.owner
      ALTER FOREIGN DATA WRAPPER test_fdw OWNER TO owner2

      -- fdw.alter.options
      ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (SET host 'db.example.com', DROP port)

      -- fdw.comment.create
      COMMENT ON FOREIGN DATA WRAPPER test_fdw IS 'fdw comment'

      -- fdw.comment.drop
      COMMENT ON FOREIGN DATA WRAPPER test_fdw IS NULL

      -- fdw.privilege.grant
      GRANT ALL ON FOREIGN DATA WRAPPER test_fdw TO app_user

      -- fdw.privilege.revoke
      REVOKE ALL ON FOREIGN DATA WRAPPER test_fdw FROM app_user

      -- fdw.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FOREIGN DATA WRAPPER test_fdw FROM app_user

      -- fdw.drop
      DROP FOREIGN DATA WRAPPER test_fdw

      -- server.create
      CREATE SERVER test_server
      VERSION '1.0'
      FOREIGN DATA WRAPPER test_fdw
      OPTIONS (
        host 'localhost',
        port '5432'
      )

      -- server.alter.owner
      ALTER SERVER test_server OWNER TO owner2

      -- server.alter.version
      ALTER SERVER test_server VERSION '2.0'

      -- server.alter.options
      ALTER SERVER test_server OPTIONS (ADD updatable 'true', DROP port)

      -- server.comment.create
      COMMENT ON SERVER test_server IS 'server comment'

      -- server.comment.drop
      COMMENT ON SERVER test_server IS NULL

      -- server.privilege.grant
      GRANT ALL ON SERVER test_server TO app_user

      -- server.privilege.revoke
      REVOKE ALL ON SERVER test_server FROM app_user

      -- server.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON SERVER test_server FROM app_user

      -- server.drop
      DROP SERVER test_server

      -- foreign_table.create
      CREATE FOREIGN TABLE public.test_table (
        id   integer,
        name text
      )
      SERVER test_server
      OPTIONS (
        schema_name 'remote_schema',
        table_name 'remote_table'
      )

      -- foreign_table.alter.owner
      ALTER FOREIGN TABLE public.test_table OWNER TO owner2

      -- foreign_table.alter.add_column
      ALTER FOREIGN TABLE public.test_table ADD COLUMN extra text

      -- foreign_table.alter.drop_column
      ALTER FOREIGN TABLE public.test_table DROP COLUMN name

      -- foreign_table.alter.column_type
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name TYPE varchar(120)

      -- foreign_table.alter.column_set_default
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name SET DEFAULT 'unknown'

      -- foreign_table.alter.column_drop_default
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name DROP DEFAULT

      -- foreign_table.alter.column_set_not_null
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name SET NOT NULL

      -- foreign_table.alter.column_drop_not_null
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name DROP NOT NULL

      -- foreign_table.alter.options
      ALTER FOREIGN TABLE public.test_table OPTIONS (SET schema_name 'remote', DROP table_name)

      -- foreign_table.comment.create
      COMMENT ON FOREIGN TABLE public.test_table IS 'foreign table comment'

      -- foreign_table.comment.drop
      COMMENT ON FOREIGN TABLE public.test_table IS NULL

      -- foreign_table.privilege.grant
      GRANT SELECT ON FOREIGN TABLE public.test_table TO app_user

      -- foreign_table.privilege.revoke
      REVOKE SELECT ON FOREIGN TABLE public.test_table FROM app_user

      -- foreign_table.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT ON FOREIGN TABLE public.test_table FROM app_user

      -- foreign_table.drop
      DROP FOREIGN TABLE public.test_table

      -- user_mapping.create
      CREATE USER MAPPING FOR PUBLIC
      SERVER test_server
      OPTIONS (
        user 'remote_user',
        password 'secret'
      )

      -- user_mapping.alter.options
      ALTER USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (SET user 'remote_user', DROP password)

      -- user_mapping.drop
      DROP USER MAPPING FOR PUBLIC SERVER test_server"
    `);
  });

  test(formatPrettyLowerLeading.header, () => {
    const output = `${formatPrettyLowerLeading.header}\n\n${renderChanges(
      changes,
      formatPrettyLowerLeading.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }

      -- fdw.create
      create foreign data wrapper test_fdw
      handler public.handler_func()
      validator public.validator_func()
      options (
            host 'localhost'
          , port '5432'
      )

      -- fdw.alter.owner
      alter foreign data wrapper test_fdw owner to owner2

      -- fdw.alter.options
      alter foreign data wrapper test_fdw options (set host 'db.example.com', drop port)

      -- fdw.comment.create
      comment on foreign data wrapper test_fdw is 'fdw comment'

      -- fdw.comment.drop
      comment on foreign data wrapper test_fdw is null

      -- fdw.privilege.grant
      grant all on foreign data wrapper test_fdw to app_user

      -- fdw.privilege.revoke
      revoke all on foreign data wrapper test_fdw from app_user

      -- fdw.privilege.revoke_grant_option
      revoke grant option for all on foreign data wrapper test_fdw from app_user

      -- fdw.drop
      drop foreign data wrapper test_fdw

      -- server.create
      create server test_server
      version '1.0'
      foreign data wrapper test_fdw
      options (
            host 'localhost'
          , port '5432'
      )

      -- server.alter.owner
      alter server test_server owner to owner2

      -- server.alter.version
      alter server test_server version '2.0'

      -- server.alter.options
      alter server test_server options (add updatable 'true', drop port)

      -- server.comment.create
      comment on server test_server is 'server comment'

      -- server.comment.drop
      comment on server test_server is null

      -- server.privilege.grant
      grant all on server test_server to app_user

      -- server.privilege.revoke
      revoke all on server test_server from app_user

      -- server.privilege.revoke_grant_option
      revoke grant option for all on server test_server from app_user

      -- server.drop
      drop server test_server

      -- foreign_table.create
      create foreign table public.test_table (
            id   integer
          , name text
      )
      server test_server
      options (
            schema_name 'remote_schema'
          , table_name 'remote_table'
      )

      -- foreign_table.alter.owner
      alter foreign table public.test_table owner to owner2

      -- foreign_table.alter.add_column
      alter foreign table public.test_table add column extra text

      -- foreign_table.alter.drop_column
      alter foreign table public.test_table drop column name

      -- foreign_table.alter.column_type
      alter foreign table public.test_table alter column name type varchar(120)

      -- foreign_table.alter.column_set_default
      alter foreign table public.test_table alter column name set default 'unknown'

      -- foreign_table.alter.column_drop_default
      alter foreign table public.test_table alter column name drop default

      -- foreign_table.alter.column_set_not_null
      alter foreign table public.test_table alter column name set not null

      -- foreign_table.alter.column_drop_not_null
      alter foreign table public.test_table alter column name drop not null

      -- foreign_table.alter.options
      alter foreign table public.test_table options (set schema_name 'remote', drop table_name)

      -- foreign_table.comment.create
      comment on foreign table public.test_table is 'foreign table comment'

      -- foreign_table.comment.drop
      comment on foreign table public.test_table is null

      -- foreign_table.privilege.grant
      grant select on foreign table public.test_table to app_user

      -- foreign_table.privilege.revoke
      revoke select on foreign table public.test_table from app_user

      -- foreign_table.privilege.revoke_grant_option
      revoke grant option for select on foreign table public.test_table from app_user

      -- foreign_table.drop
      drop foreign table public.test_table

      -- user_mapping.create
      create user mapping for PUBLIC
      server test_server
      options (
            user 'remote_user'
          , password 'secret'
      )

      -- user_mapping.alter.options
      alter user mapping for PUBLIC server test_server options (set user 'remote_user', drop password)

      -- user_mapping.drop
      drop user mapping for PUBLIC server test_server"
    `);
  });

  test(formatPrettyNarrow.header, () => {
    const output = `${formatPrettyNarrow.header}\n\n${renderChanges(
      changes,
      formatPrettyNarrow.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, lineWidth: 40 }

      -- fdw.create
      CREATE FOREIGN DATA WRAPPER test_fdw
      HANDLER public.handler_func()
      VALIDATOR public.validator_func()
      OPTIONS (
        host 'localhost',
        port '5432'
      )

      -- fdw.alter.owner
      ALTER FOREIGN DATA WRAPPER test_fdw
        OWNER TO owner2

      -- fdw.alter.options
      ALTER FOREIGN DATA WRAPPER test_fdw
        OPTIONS (SET host 'db.example.com',
        DROP port)

      -- fdw.comment.create
      COMMENT ON FOREIGN DATA WRAPPER test_fdw
        IS 'fdw comment'

      -- fdw.comment.drop
      COMMENT ON FOREIGN DATA WRAPPER test_fdw
        IS NULL

      -- fdw.privilege.grant
      GRANT ALL ON FOREIGN DATA WRAPPER
        test_fdw TO app_user

      -- fdw.privilege.revoke
      REVOKE ALL ON FOREIGN DATA WRAPPER
        test_fdw FROM app_user

      -- fdw.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FOREIGN
        DATA WRAPPER test_fdw FROM app_user

      -- fdw.drop
      DROP FOREIGN DATA WRAPPER test_fdw

      -- server.create
      CREATE SERVER test_server
      VERSION '1.0'
      FOREIGN DATA WRAPPER test_fdw
      OPTIONS (
        host 'localhost',
        port '5432'
      )

      -- server.alter.owner
      ALTER SERVER test_server OWNER TO owner2

      -- server.alter.version
      ALTER SERVER test_server VERSION '2.0'

      -- server.alter.options
      ALTER SERVER test_server OPTIONS (ADD
        updatable 'true', DROP port)

      -- server.comment.create
      COMMENT ON SERVER test_server IS 'server
        comment'

      -- server.comment.drop
      COMMENT ON SERVER test_server IS NULL

      -- server.privilege.grant
      GRANT ALL ON SERVER test_server TO
        app_user

      -- server.privilege.revoke
      REVOKE ALL ON SERVER test_server FROM
        app_user

      -- server.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON SERVER
        test_server FROM app_user

      -- server.drop
      DROP SERVER test_server

      -- foreign_table.create
      CREATE FOREIGN TABLE public.test_table (
        id   integer,
        name text
      )
      SERVER test_server
      OPTIONS (
        schema_name 'remote_schema',
        table_name 'remote_table'
      )

      -- foreign_table.alter.owner
      ALTER FOREIGN TABLE public.test_table
        OWNER TO owner2

      -- foreign_table.alter.add_column
      ALTER FOREIGN TABLE public.test_table
        ADD COLUMN extra text

      -- foreign_table.alter.drop_column
      ALTER FOREIGN TABLE public.test_table
        DROP COLUMN name

      -- foreign_table.alter.column_type
      ALTER FOREIGN TABLE public.test_table
        ALTER COLUMN name TYPE varchar(120)

      -- foreign_table.alter.column_set_default
      ALTER FOREIGN TABLE public.test_table
        ALTER COLUMN name SET DEFAULT
        'unknown'

      -- foreign_table.alter.column_drop_default
      ALTER FOREIGN TABLE public.test_table
        ALTER COLUMN name DROP DEFAULT

      -- foreign_table.alter.column_set_not_null
      ALTER FOREIGN TABLE public.test_table
        ALTER COLUMN name SET NOT NULL

      -- foreign_table.alter.column_drop_not_null
      ALTER FOREIGN TABLE public.test_table
        ALTER COLUMN name DROP NOT NULL

      -- foreign_table.alter.options
      ALTER FOREIGN TABLE public.test_table
        OPTIONS (SET schema_name 'remote',
        DROP table_name)

      -- foreign_table.comment.create
      COMMENT ON FOREIGN TABLE
        public.test_table IS 'foreign table
        comment'

      -- foreign_table.comment.drop
      COMMENT ON FOREIGN TABLE
        public.test_table IS NULL

      -- foreign_table.privilege.grant
      GRANT SELECT ON FOREIGN TABLE
        public.test_table TO app_user

      -- foreign_table.privilege.revoke
      REVOKE SELECT ON FOREIGN TABLE
        public.test_table FROM app_user

      -- foreign_table.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT ON
        FOREIGN TABLE public.test_table FROM
        app_user

      -- foreign_table.drop
      DROP FOREIGN TABLE public.test_table

      -- user_mapping.create
      CREATE USER MAPPING FOR PUBLIC
      SERVER test_server
      OPTIONS (
        user 'remote_user',
        password 'secret'
      )

      -- user_mapping.alter.options
      ALTER USER MAPPING FOR PUBLIC SERVER
        test_server OPTIONS (SET user
        'remote_user', DROP password)

      -- user_mapping.drop
      DROP USER MAPPING FOR PUBLIC SERVER
        test_server"
    `);
  });

  test(formatPrettyPreserve.header, () => {
    const output = `${formatPrettyPreserve.header}\n\n${renderChanges(
      changes,
      formatPrettyPreserve.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }

      -- fdw.create
      CREATE FOREIGN DATA WRAPPER test_fdw
      HANDLER public.handler_func()
      VALIDATOR public.validator_func()
      OPTIONS (
         host 'localhost',
         port '5432'
      )

      -- fdw.alter.owner
      ALTER FOREIGN DATA WRAPPER test_fdw OWNER TO owner2

      -- fdw.alter.options
      ALTER FOREIGN DATA WRAPPER test_fdw OPTIONS (SET host 'db.example.com', DROP port)

      -- fdw.comment.create
      COMMENT ON FOREIGN DATA WRAPPER test_fdw IS 'fdw comment'

      -- fdw.comment.drop
      COMMENT ON FOREIGN DATA WRAPPER test_fdw IS NULL

      -- fdw.privilege.grant
      GRANT ALL ON FOREIGN DATA WRAPPER test_fdw TO app_user

      -- fdw.privilege.revoke
      REVOKE ALL ON FOREIGN DATA WRAPPER test_fdw FROM app_user

      -- fdw.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON FOREIGN DATA WRAPPER test_fdw FROM app_user

      -- fdw.drop
      DROP FOREIGN DATA WRAPPER test_fdw

      -- server.create
      CREATE SERVER test_server
      VERSION '1.0'
      FOREIGN DATA WRAPPER test_fdw
      OPTIONS (
         host 'localhost',
         port '5432'
      )

      -- server.alter.owner
      ALTER SERVER test_server OWNER TO owner2

      -- server.alter.version
      ALTER SERVER test_server VERSION '2.0'

      -- server.alter.options
      ALTER SERVER test_server OPTIONS (ADD updatable 'true', DROP port)

      -- server.comment.create
      COMMENT ON SERVER test_server IS 'server comment'

      -- server.comment.drop
      COMMENT ON SERVER test_server IS NULL

      -- server.privilege.grant
      GRANT ALL ON SERVER test_server TO app_user

      -- server.privilege.revoke
      REVOKE ALL ON SERVER test_server FROM app_user

      -- server.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR ALL ON SERVER test_server FROM app_user

      -- server.drop
      DROP SERVER test_server

      -- foreign_table.create
      CREATE FOREIGN TABLE public.test_table (
         id integer,
         name text
      )
      SERVER test_server
      OPTIONS (
         schema_name 'remote_schema',
         table_name 'remote_table'
      )

      -- foreign_table.alter.owner
      ALTER FOREIGN TABLE public.test_table OWNER TO owner2

      -- foreign_table.alter.add_column
      ALTER FOREIGN TABLE public.test_table ADD COLUMN extra text

      -- foreign_table.alter.drop_column
      ALTER FOREIGN TABLE public.test_table DROP COLUMN name

      -- foreign_table.alter.column_type
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name TYPE varchar(120)

      -- foreign_table.alter.column_set_default
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name SET DEFAULT 'unknown'

      -- foreign_table.alter.column_drop_default
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name DROP DEFAULT

      -- foreign_table.alter.column_set_not_null
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name SET NOT NULL

      -- foreign_table.alter.column_drop_not_null
      ALTER FOREIGN TABLE public.test_table ALTER COLUMN name DROP NOT NULL

      -- foreign_table.alter.options
      ALTER FOREIGN TABLE public.test_table OPTIONS (SET schema_name 'remote', DROP table_name)

      -- foreign_table.comment.create
      COMMENT ON FOREIGN TABLE public.test_table IS 'foreign table comment'

      -- foreign_table.comment.drop
      COMMENT ON FOREIGN TABLE public.test_table IS NULL

      -- foreign_table.privilege.grant
      GRANT SELECT ON FOREIGN TABLE public.test_table TO app_user

      -- foreign_table.privilege.revoke
      REVOKE SELECT ON FOREIGN TABLE public.test_table FROM app_user

      -- foreign_table.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT ON FOREIGN TABLE public.test_table FROM app_user

      -- foreign_table.drop
      DROP FOREIGN TABLE public.test_table

      -- user_mapping.create
      CREATE USER MAPPING FOR PUBLIC
      SERVER test_server
      OPTIONS (
         user 'remote_user',
         password 'secret'
      )

      -- user_mapping.alter.options
      ALTER USER MAPPING FOR PUBLIC SERVER test_server OPTIONS (SET user 'remote_user', DROP password)

      -- user_mapping.drop
      DROP USER MAPPING FOR PUBLIC SERVER test_server"
    `);
  });
});
