import { describe, expect, test } from "vitest";
import {
  type ChangeCase,
  formatCases,
  pgVersion,
  priv,
  renderChanges,
  partitionedTable,
  partitionTable,
  sequence,
  table,
  tableAlterColumn,
  tableConstraint,
  tableDefaultColumn,
  tableTypeColumn,
} from "./fixtures.ts";
import {
  AlterTableAddColumn,
  AlterTableAddConstraint,
  AlterTableAlterColumnDropDefault,
  AlterTableAlterColumnDropNotNull,
  AlterTableAlterColumnSetDefault,
  AlterTableAlterColumnSetNotNull,
  AlterTableAlterColumnType,
  AlterTableAttachPartition,
  AlterTableChangeOwner,
  AlterTableDetachPartition,
  AlterTableDisableRowLevelSecurity,
  AlterTableDropColumn,
  AlterTableDropConstraint,
  AlterTableEnableRowLevelSecurity,
  AlterTableForceRowLevelSecurity,
  AlterTableNoForceRowLevelSecurity,
  AlterTableResetStorageParams,
  AlterTableSetLogged,
  AlterTableSetReplicaIdentity,
  AlterTableSetStorageParams,
  AlterTableSetUnlogged,
  AlterTableValidateConstraint,
} from "../../../src/core/objects/table/changes/table.alter.ts";
import { CreateTable } from "../../../src/core/objects/table/changes/table.create.ts";
import {
  CreateCommentOnColumn,
  CreateCommentOnConstraint,
  CreateCommentOnTable,
  DropCommentOnColumn,
  DropCommentOnConstraint,
  DropCommentOnTable,
} from "../../../src/core/objects/table/changes/table.comment.ts";
import { DropTable } from "../../../src/core/objects/table/changes/table.drop.ts";
import {
  GrantTablePrivileges,
  RevokeGrantOptionTablePrivileges,
  RevokeTablePrivileges,
} from "../../../src/core/objects/table/changes/table.privilege.ts";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
} from "../../../src/core/objects/sequence/changes/sequence.alter.ts";
import { CreateSequence } from "../../../src/core/objects/sequence/changes/sequence.create.ts";
import {
  CreateCommentOnSequence,
  DropCommentOnSequence,
} from "../../../src/core/objects/sequence/changes/sequence.comment.ts";
import { DropSequence } from "../../../src/core/objects/sequence/changes/sequence.drop.ts";
import {
  GrantSequencePrivileges,
  RevokeGrantOptionSequencePrivileges,
  RevokeSequencePrivileges,
} from "../../../src/core/objects/sequence/changes/sequence.privilege.ts";

const changes: ChangeCase[] = [
  { label: "table.create", change: new CreateTable({ table }) },
  {
    label: "table.alter.owner",
    change: new AlterTableChangeOwner({ table, owner: "owner2" }),
  },
  { label: "table.alter.set_logged", change: new AlterTableSetLogged({ table }) },
  {
    label: "table.alter.set_unlogged",
    change: new AlterTableSetUnlogged({ table }),
  },
  {
    label: "table.alter.enable_rls",
    change: new AlterTableEnableRowLevelSecurity({ table }),
  },
  {
    label: "table.alter.disable_rls",
    change: new AlterTableDisableRowLevelSecurity({ table }),
  },
  {
    label: "table.alter.force_rls",
    change: new AlterTableForceRowLevelSecurity({ table }),
  },
  {
    label: "table.alter.no_force_rls",
    change: new AlterTableNoForceRowLevelSecurity({ table }),
  },
  {
    label: "table.alter.set_storage_params",
    change: new AlterTableSetStorageParams({
      table,
      options: ["fillfactor=80", "toast.autovacuum_enabled=false"],
    }),
  },
  {
    label: "table.alter.reset_storage_params",
    change: new AlterTableResetStorageParams({
      table,
      params: ["fillfactor"],
    }),
  },
  {
    label: "table.alter.add_constraint",
    change: new AlterTableAddConstraint({ table, constraint: tableConstraint }),
  },
  {
    label: "table.alter.drop_constraint",
    change: new AlterTableDropConstraint({ table, constraint: tableConstraint }),
  },
  {
    label: "table.alter.validate_constraint",
    change: new AlterTableValidateConstraint({ table, constraint: tableConstraint }),
  },
  {
    label: "table.alter.replica_identity",
    change: new AlterTableSetReplicaIdentity({ table, mode: "f" }),
  },
  {
    label: "table.alter.add_column",
    change: new AlterTableAddColumn({ table, column: tableAlterColumn }),
  },
  {
    label: "table.alter.drop_column",
    change: new AlterTableDropColumn({ table, column: table.columns[1] }),
  },
  {
    label: "table.alter.column_type",
    change: new AlterTableAlterColumnType({ table, column: tableTypeColumn }),
  },
  {
    label: "table.alter.column_set_default",
    change: new AlterTableAlterColumnSetDefault({
      table,
      column: tableDefaultColumn,
    }),
  },
  {
    label: "table.alter.column_drop_default",
    change: new AlterTableAlterColumnDropDefault({ table, column: table.columns[1] }),
  },
  {
    label: "table.alter.column_set_not_null",
    change: new AlterTableAlterColumnSetNotNull({ table, column: table.columns[1] }),
  },
  {
    label: "table.alter.column_drop_not_null",
    change: new AlterTableAlterColumnDropNotNull({ table, column: table.columns[1] }),
  },
  {
    label: "table.alter.attach_partition",
    change: new AlterTableAttachPartition({
      table: partitionedTable,
      partition: partitionTable,
    }),
  },
  {
    label: "table.alter.detach_partition",
    change: new AlterTableDetachPartition({
      table: partitionedTable,
      partition: partitionTable,
    }),
  },
  { label: "table.comment.create", change: new CreateCommentOnTable({ table }) },
  { label: "table.comment.drop", change: new DropCommentOnTable({ table }) },
  {
    label: "table.comment.column.create",
    change: new CreateCommentOnColumn({ table, column: table.columns[0] }),
  },
  {
    label: "table.comment.column.drop",
    change: new DropCommentOnColumn({ table, column: table.columns[0] }),
  },
  {
    label: "table.comment.constraint.create",
    change: new CreateCommentOnConstraint({ table, constraint: tableConstraint }),
  },
  {
    label: "table.comment.constraint.drop",
    change: new DropCommentOnConstraint({ table, constraint: tableConstraint }),
  },
  {
    label: "table.privilege.grant",
    change: new GrantTablePrivileges({
      table,
      grantee: "app_user",
      privileges: [priv("SELECT")],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  {
    label: "table.privilege.revoke",
    change: new RevokeTablePrivileges({
      table,
      grantee: "app_user",
      privileges: [priv("SELECT")],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  {
    label: "table.privilege.revoke_grant_option",
    change: new RevokeGrantOptionTablePrivileges({
      table,
      grantee: "app_user",
      privilegeNames: ["SELECT"],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  { label: "table.drop", change: new DropTable({ table }) },

  { label: "sequence.create", change: new CreateSequence({ sequence }) },
  {
    label: "sequence.alter.owned_by",
    change: new AlterSequenceSetOwnedBy({
      sequence,
      ownedBy: { schema: "public", table: "t_fmt", column: "id" },
    }),
  },
  {
    label: "sequence.alter.options",
    change: new AlterSequenceSetOptions({
      sequence,
      options: ["INCREMENT BY 2", "MINVALUE 1", "MAXVALUE 100"],
    }),
  },
  {
    label: "sequence.comment.create",
    change: new CreateCommentOnSequence({ sequence }),
  },
  { label: "sequence.comment.drop", change: new DropCommentOnSequence({ sequence }) },
  {
    label: "sequence.privilege.grant",
    change: new GrantSequencePrivileges({
      sequence,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "sequence.privilege.revoke",
    change: new RevokeSequencePrivileges({
      sequence,
      grantee: "app_user",
      privileges: [priv("USAGE")],
      version: pgVersion,
    }),
  },
  {
    label: "sequence.privilege.revoke_grant_option",
    change: new RevokeGrantOptionSequencePrivileges({
      sequence,
      grantee: "app_user",
      privilegeNames: ["USAGE"],
      version: pgVersion,
    }),
  },
  { label: "sequence.drop", change: new DropSequence({ sequence }) },
];

describe("format options: table + sequence", () => {
  const [formatOff, formatPrettyUpper, formatPrettyLowerLeading, formatPrettyNarrow, formatPrettyPreserve] =
    formatCases;

  test(formatOff.header, () => {
    const output = `${formatOff.header}\n\n${renderChanges(
      changes,
      formatOff.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: off

      -- table.create
      CREATE TABLE public.t_fmt (id bigint NOT NULL, status text DEFAULT 'pending') WITH (fillfactor=70)

      -- table.alter.owner
      ALTER TABLE public.t_fmt OWNER TO owner2

      -- table.alter.set_logged
      ALTER TABLE public.t_fmt SET LOGGED

      -- table.alter.set_unlogged
      ALTER TABLE public.t_fmt SET UNLOGGED

      -- table.alter.enable_rls
      ALTER TABLE public.t_fmt ENABLE ROW LEVEL SECURITY

      -- table.alter.disable_rls
      ALTER TABLE public.t_fmt DISABLE ROW LEVEL SECURITY

      -- table.alter.force_rls
      ALTER TABLE public.t_fmt FORCE ROW LEVEL SECURITY

      -- table.alter.no_force_rls
      ALTER TABLE public.t_fmt NO FORCE ROW LEVEL SECURITY

      -- table.alter.set_storage_params
      ALTER TABLE public.t_fmt SET (fillfactor=80, toast.autovacuum_enabled=false)

      -- table.alter.reset_storage_params
      ALTER TABLE public.t_fmt RESET (fillfactor)

      -- table.alter.add_constraint
      ALTER TABLE public.t_fmt ADD CONSTRAINT chk_positive CHECK (id > 0)

      -- table.alter.drop_constraint
      ALTER TABLE public.t_fmt DROP CONSTRAINT chk_positive

      -- table.alter.validate_constraint
      ALTER TABLE public.t_fmt VALIDATE CONSTRAINT chk_positive

      -- table.alter.replica_identity
      ALTER TABLE public.t_fmt REPLICA IDENTITY FULL

      -- table.alter.add_column
      ALTER TABLE public.t_fmt ADD COLUMN new_col text DEFAULT 'new' NOT NULL

      -- table.alter.drop_column
      ALTER TABLE public.t_fmt DROP COLUMN status

      -- table.alter.column_type
      ALTER TABLE public.t_fmt ALTER COLUMN status TYPE varchar(32) COLLATE "en_US"

      -- table.alter.column_set_default
      ALTER TABLE public.t_fmt ALTER COLUMN created_at SET DEFAULT now()

      -- table.alter.column_drop_default
      ALTER TABLE public.t_fmt ALTER COLUMN status DROP DEFAULT

      -- table.alter.column_set_not_null
      ALTER TABLE public.t_fmt ALTER COLUMN status SET NOT NULL

      -- table.alter.column_drop_not_null
      ALTER TABLE public.t_fmt ALTER COLUMN status DROP NOT NULL

      -- table.alter.attach_partition
      ALTER TABLE public.t_parent ATTACH PARTITION public.t_child_1 FOR VALUES FROM (1) TO (100)

      -- table.alter.detach_partition
      ALTER TABLE public.t_parent DETACH PARTITION public.t_child_1

      -- table.comment.create
      COMMENT ON TABLE public.t_fmt IS 'table comment'

      -- table.comment.drop
      COMMENT ON TABLE public.t_fmt IS NULL

      -- table.comment.column.create
      COMMENT ON COLUMN public.t_fmt.id IS 'id column'

      -- table.comment.column.drop
      COMMENT ON COLUMN public.t_fmt.id IS NULL

      -- table.comment.constraint.create
      COMMENT ON CONSTRAINT chk_positive ON public.t_fmt IS 'constraint comment'

      -- table.comment.constraint.drop
      COMMENT ON CONSTRAINT chk_positive ON public.t_fmt IS NULL

      -- table.privilege.grant
      GRANT SELECT (id) ON public.t_fmt TO app_user

      -- table.privilege.revoke
      REVOKE SELECT (id) ON public.t_fmt FROM app_user

      -- table.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.t_fmt FROM app_user

      -- table.drop
      DROP TABLE public.t_fmt

      -- sequence.create
      CREATE SEQUENCE public.s_all AS integer INCREMENT BY 2 MINVALUE 5 MAXVALUE 100 START WITH 10 CACHE 3 CYCLE

      -- sequence.alter.owned_by
      ALTER SEQUENCE public.s_all OWNED BY public.t_fmt.id

      -- sequence.alter.options
      ALTER SEQUENCE public.s_all INCREMENT BY 2 MINVALUE 1 MAXVALUE 100

      -- sequence.comment.create
      COMMENT ON SEQUENCE public.s_all IS 'sequence comment'

      -- sequence.comment.drop
      COMMENT ON SEQUENCE public.s_all IS NULL

      -- sequence.privilege.grant
      GRANT USAGE ON SEQUENCE public.s_all TO app_user

      -- sequence.privilege.revoke
      REVOKE USAGE ON SEQUENCE public.s_all FROM app_user

      -- sequence.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE ON SEQUENCE public.s_all FROM app_user

      -- sequence.drop
      DROP SEQUENCE public.s_all"
    `);
  });

  test(formatPrettyUpper.header, () => {
    const output = `${formatPrettyUpper.header}\n\n${renderChanges(
      changes,
      formatPrettyUpper.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true }

      -- table.create
      CREATE TABLE public.t_fmt (
        id     bigint NOT NULL,
        status text   DEFAULT 'pending'
      )
      WITH (fillfactor=70)

      -- table.alter.owner
      ALTER TABLE public.t_fmt OWNER TO owner2

      -- table.alter.set_logged
      ALTER TABLE public.t_fmt SET LOGGED

      -- table.alter.set_unlogged
      ALTER TABLE public.t_fmt SET UNLOGGED

      -- table.alter.enable_rls
      ALTER TABLE public.t_fmt ENABLE ROW LEVEL SECURITY

      -- table.alter.disable_rls
      ALTER TABLE public.t_fmt DISABLE ROW LEVEL SECURITY

      -- table.alter.force_rls
      ALTER TABLE public.t_fmt FORCE ROW LEVEL SECURITY

      -- table.alter.no_force_rls
      ALTER TABLE public.t_fmt NO FORCE ROW LEVEL SECURITY

      -- table.alter.set_storage_params
      ALTER TABLE public.t_fmt SET (fillfactor=80, toast.autovacuum_enabled=false)

      -- table.alter.reset_storage_params
      ALTER TABLE public.t_fmt RESET (fillfactor)

      -- table.alter.add_constraint
      ALTER TABLE public.t_fmt ADD CONSTRAINT chk_positive CHECK (id > 0)

      -- table.alter.drop_constraint
      ALTER TABLE public.t_fmt DROP CONSTRAINT chk_positive

      -- table.alter.validate_constraint
      ALTER TABLE public.t_fmt VALIDATE CONSTRAINT chk_positive

      -- table.alter.replica_identity
      ALTER TABLE public.t_fmt REPLICA IDENTITY FULL

      -- table.alter.add_column
      ALTER TABLE public.t_fmt ADD COLUMN new_col text DEFAULT 'new' NOT NULL

      -- table.alter.drop_column
      ALTER TABLE public.t_fmt DROP COLUMN status

      -- table.alter.column_type
      ALTER TABLE public.t_fmt ALTER COLUMN status TYPE varchar(32) COLLATE "en_US"

      -- table.alter.column_set_default
      ALTER TABLE public.t_fmt ALTER COLUMN created_at SET DEFAULT now()

      -- table.alter.column_drop_default
      ALTER TABLE public.t_fmt ALTER COLUMN status DROP DEFAULT

      -- table.alter.column_set_not_null
      ALTER TABLE public.t_fmt ALTER COLUMN status SET NOT NULL

      -- table.alter.column_drop_not_null
      ALTER TABLE public.t_fmt ALTER COLUMN status DROP NOT NULL

      -- table.alter.attach_partition
      ALTER TABLE public.t_parent ATTACH PARTITION public.t_child_1 FOR VALUES FROM (1) TO (100)

      -- table.alter.detach_partition
      ALTER TABLE public.t_parent DETACH PARTITION public.t_child_1

      -- table.comment.create
      COMMENT ON TABLE public.t_fmt IS 'table comment'

      -- table.comment.drop
      COMMENT ON TABLE public.t_fmt IS NULL

      -- table.comment.column.create
      COMMENT ON COLUMN public.t_fmt.id IS 'id column'

      -- table.comment.column.drop
      COMMENT ON COLUMN public.t_fmt.id IS NULL

      -- table.comment.constraint.create
      COMMENT ON CONSTRAINT chk_positive ON public.t_fmt IS 'constraint comment'

      -- table.comment.constraint.drop
      COMMENT ON CONSTRAINT chk_positive ON public.t_fmt IS NULL

      -- table.privilege.grant
      GRANT SELECT (id) ON public.t_fmt TO app_user

      -- table.privilege.revoke
      REVOKE SELECT (id) ON public.t_fmt FROM app_user

      -- table.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.t_fmt FROM app_user

      -- table.drop
      DROP TABLE public.t_fmt

      -- sequence.create
      CREATE SEQUENCE public.s_all
      AS integer
      INCREMENT BY 2
      MINVALUE 5
      MAXVALUE 100
      START WITH 10
      CACHE 3
      CYCLE

      -- sequence.alter.owned_by
      ALTER SEQUENCE public.s_all OWNED BY public.t_fmt.id

      -- sequence.alter.options
      ALTER SEQUENCE public.s_all INCREMENT BY 2 MINVALUE 1 MAXVALUE 100

      -- sequence.comment.create
      COMMENT ON SEQUENCE public.s_all IS 'sequence comment'

      -- sequence.comment.drop
      COMMENT ON SEQUENCE public.s_all IS NULL

      -- sequence.privilege.grant
      GRANT USAGE ON SEQUENCE public.s_all TO app_user

      -- sequence.privilege.revoke
      REVOKE USAGE ON SEQUENCE public.s_all FROM app_user

      -- sequence.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE ON SEQUENCE public.s_all FROM app_user

      -- sequence.drop
      DROP SEQUENCE public.s_all"
    `);
  });

  test(formatPrettyLowerLeading.header, () => {
    const output = `${formatPrettyLowerLeading.header}\n\n${renderChanges(
      changes,
      formatPrettyLowerLeading.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }

      -- table.create
      create table public.t_fmt (
            id     bigint not null
          , status text   default 'pending'
      )
      with (fillfactor=70)

      -- table.alter.owner
      alter table public.t_fmt owner to owner2

      -- table.alter.set_logged
      alter table public.t_fmt set logged

      -- table.alter.set_unlogged
      alter table public.t_fmt set unlogged

      -- table.alter.enable_rls
      alter table public.t_fmt enable row level security

      -- table.alter.disable_rls
      alter table public.t_fmt disable row level security

      -- table.alter.force_rls
      alter table public.t_fmt force row level security

      -- table.alter.no_force_rls
      alter table public.t_fmt no force row level security

      -- table.alter.set_storage_params
      alter table public.t_fmt set (fillfactor=80, toast.autovacuum_enabled=false)

      -- table.alter.reset_storage_params
      alter table public.t_fmt reset (fillfactor)

      -- table.alter.add_constraint
      alter table public.t_fmt add constraint chk_positive CHECK (id > 0)

      -- table.alter.drop_constraint
      alter table public.t_fmt drop constraint chk_positive

      -- table.alter.validate_constraint
      alter table public.t_fmt validate constraint chk_positive

      -- table.alter.replica_identity
      alter table public.t_fmt replica identity full

      -- table.alter.add_column
      alter table public.t_fmt add column new_col text default 'new' not null

      -- table.alter.drop_column
      alter table public.t_fmt drop column status

      -- table.alter.column_type
      alter table public.t_fmt alter column status type varchar(32) collate "en_US"

      -- table.alter.column_set_default
      alter table public.t_fmt alter column created_at set default now()

      -- table.alter.column_drop_default
      alter table public.t_fmt alter column status drop default

      -- table.alter.column_set_not_null
      alter table public.t_fmt alter column status set not null

      -- table.alter.column_drop_not_null
      alter table public.t_fmt alter column status drop not null

      -- table.alter.attach_partition
      alter table public.t_parent attach partition public.t_child_1 FOR VALUES FROM (1) TO (100)

      -- table.alter.detach_partition
      alter table public.t_parent detach partition public.t_child_1

      -- table.comment.create
      comment on table public.t_fmt is 'table comment'

      -- table.comment.drop
      comment on table public.t_fmt is null

      -- table.comment.column.create
      comment on column public.t_fmt.id is 'id column'

      -- table.comment.column.drop
      comment on column public.t_fmt.id is null

      -- table.comment.constraint.create
      comment on constraint chk_positive on public.t_fmt is 'constraint comment'

      -- table.comment.constraint.drop
      comment on constraint chk_positive on public.t_fmt is null

      -- table.privilege.grant
      grant select (id) on public.t_fmt to app_user

      -- table.privilege.revoke
      revoke select (id) on public.t_fmt from app_user

      -- table.privilege.revoke_grant_option
      revoke grant option for select (id) on public.t_fmt from app_user

      -- table.drop
      drop table public.t_fmt

      -- sequence.create
      create sequence public.s_all
      as integer
      increment by 2
      minvalue 5
      maxvalue 100
      start with 10
      cache 3
      cycle

      -- sequence.alter.owned_by
      alter sequence public.s_all owned by public.t_fmt.id

      -- sequence.alter.options
      alter sequence public.s_all INCREMENT BY 2 MINVALUE 1 MAXVALUE 100

      -- sequence.comment.create
      comment on sequence public.s_all is 'sequence comment'

      -- sequence.comment.drop
      comment on sequence public.s_all is null

      -- sequence.privilege.grant
      grant usage on sequence public.s_all to app_user

      -- sequence.privilege.revoke
      revoke usage on sequence public.s_all from app_user

      -- sequence.privilege.revoke_grant_option
      revoke grant option for usage on sequence public.s_all from app_user

      -- sequence.drop
      drop sequence public.s_all"
    `);
  });

  test(formatPrettyNarrow.header, () => {
    const output = `${formatPrettyNarrow.header}\n\n${renderChanges(
      changes,
      formatPrettyNarrow.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, lineWidth: 40 }

      -- table.create
      CREATE TABLE public.t_fmt (
        id     bigint NOT NULL,
        status text   DEFAULT 'pending'
      )
      WITH (fillfactor=70)

      -- table.alter.owner
      ALTER TABLE public.t_fmt OWNER TO owner2

      -- table.alter.set_logged
      ALTER TABLE public.t_fmt SET LOGGED

      -- table.alter.set_unlogged
      ALTER TABLE public.t_fmt SET UNLOGGED

      -- table.alter.enable_rls
      ALTER TABLE public.t_fmt ENABLE ROW
        LEVEL SECURITY

      -- table.alter.disable_rls
      ALTER TABLE public.t_fmt DISABLE ROW
        LEVEL SECURITY

      -- table.alter.force_rls
      ALTER TABLE public.t_fmt FORCE ROW LEVEL
        SECURITY

      -- table.alter.no_force_rls
      ALTER TABLE public.t_fmt NO FORCE ROW
        LEVEL SECURITY

      -- table.alter.set_storage_params
      ALTER TABLE public.t_fmt SET
        (fillfactor=80,
        toast.autovacuum_enabled=false)

      -- table.alter.reset_storage_params
      ALTER TABLE public.t_fmt RESET
        (fillfactor)

      -- table.alter.add_constraint
      ALTER TABLE public.t_fmt ADD CONSTRAINT
        chk_positive CHECK (id > 0)

      -- table.alter.drop_constraint
      ALTER TABLE public.t_fmt DROP CONSTRAINT
        chk_positive

      -- table.alter.validate_constraint
      ALTER TABLE public.t_fmt VALIDATE
        CONSTRAINT chk_positive

      -- table.alter.replica_identity
      ALTER TABLE public.t_fmt REPLICA
        IDENTITY FULL

      -- table.alter.add_column
      ALTER TABLE public.t_fmt ADD COLUMN
        new_col text DEFAULT 'new' NOT NULL

      -- table.alter.drop_column
      ALTER TABLE public.t_fmt DROP COLUMN
        status

      -- table.alter.column_type
      ALTER TABLE public.t_fmt ALTER COLUMN
        status TYPE varchar(32) COLLATE
        "en_US"

      -- table.alter.column_set_default
      ALTER TABLE public.t_fmt ALTER COLUMN
        created_at SET DEFAULT now()

      -- table.alter.column_drop_default
      ALTER TABLE public.t_fmt ALTER COLUMN
        status DROP DEFAULT

      -- table.alter.column_set_not_null
      ALTER TABLE public.t_fmt ALTER COLUMN
        status SET NOT NULL

      -- table.alter.column_drop_not_null
      ALTER TABLE public.t_fmt ALTER COLUMN
        status DROP NOT NULL

      -- table.alter.attach_partition
      ALTER TABLE public.t_parent ATTACH
        PARTITION public.t_child_1 FOR VALUES
        FROM (1) TO (100)

      -- table.alter.detach_partition
      ALTER TABLE public.t_parent DETACH
        PARTITION public.t_child_1

      -- table.comment.create
      COMMENT ON TABLE public.t_fmt IS 'table
        comment'

      -- table.comment.drop
      COMMENT ON TABLE public.t_fmt IS NULL

      -- table.comment.column.create
      COMMENT ON COLUMN public.t_fmt.id IS 'id
        column'

      -- table.comment.column.drop
      COMMENT ON COLUMN public.t_fmt.id IS
        NULL

      -- table.comment.constraint.create
      COMMENT ON CONSTRAINT chk_positive ON
        public.t_fmt IS 'constraint comment'

      -- table.comment.constraint.drop
      COMMENT ON CONSTRAINT chk_positive ON
        public.t_fmt IS NULL

      -- table.privilege.grant
      GRANT SELECT (id) ON public.t_fmt TO
        app_user

      -- table.privilege.revoke
      REVOKE SELECT (id) ON public.t_fmt FROM
        app_user

      -- table.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON
        public.t_fmt FROM app_user

      -- table.drop
      DROP TABLE public.t_fmt

      -- sequence.create
      CREATE SEQUENCE public.s_all
      AS integer
      INCREMENT BY 2
      MINVALUE 5
      MAXVALUE 100
      START WITH 10
      CACHE 3
      CYCLE

      -- sequence.alter.owned_by
      ALTER SEQUENCE public.s_all OWNED BY
        public.t_fmt.id

      -- sequence.alter.options
      ALTER SEQUENCE public.s_all INCREMENT BY
        2 MINVALUE 1 MAXVALUE 100

      -- sequence.comment.create
      COMMENT ON SEQUENCE public.s_all IS
        'sequence comment'

      -- sequence.comment.drop
      COMMENT ON SEQUENCE public.s_all IS NULL

      -- sequence.privilege.grant
      GRANT USAGE ON SEQUENCE public.s_all TO
        app_user

      -- sequence.privilege.revoke
      REVOKE USAGE ON SEQUENCE public.s_all
        FROM app_user

      -- sequence.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE ON
        SEQUENCE public.s_all FROM app_user

      -- sequence.drop
      DROP SEQUENCE public.s_all"
    `);
  });

  test(formatPrettyPreserve.header, () => {
    const output = `${formatPrettyPreserve.header}\n\n${renderChanges(
      changes,
      formatPrettyPreserve.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }

      -- table.create
      CREATE TABLE public.t_fmt (
         id bigint NOT NULL,
         status text DEFAULT 'pending'
      )
      WITH (fillfactor=70)

      -- table.alter.owner
      ALTER TABLE public.t_fmt OWNER TO owner2

      -- table.alter.set_logged
      ALTER TABLE public.t_fmt SET LOGGED

      -- table.alter.set_unlogged
      ALTER TABLE public.t_fmt SET UNLOGGED

      -- table.alter.enable_rls
      ALTER TABLE public.t_fmt ENABLE ROW LEVEL SECURITY

      -- table.alter.disable_rls
      ALTER TABLE public.t_fmt DISABLE ROW LEVEL SECURITY

      -- table.alter.force_rls
      ALTER TABLE public.t_fmt FORCE ROW LEVEL SECURITY

      -- table.alter.no_force_rls
      ALTER TABLE public.t_fmt NO FORCE ROW LEVEL SECURITY

      -- table.alter.set_storage_params
      ALTER TABLE public.t_fmt SET (fillfactor=80, toast.autovacuum_enabled=false)

      -- table.alter.reset_storage_params
      ALTER TABLE public.t_fmt RESET (fillfactor)

      -- table.alter.add_constraint
      ALTER TABLE public.t_fmt ADD CONSTRAINT chk_positive CHECK (id > 0)

      -- table.alter.drop_constraint
      ALTER TABLE public.t_fmt DROP CONSTRAINT chk_positive

      -- table.alter.validate_constraint
      ALTER TABLE public.t_fmt VALIDATE CONSTRAINT chk_positive

      -- table.alter.replica_identity
      ALTER TABLE public.t_fmt REPLICA IDENTITY FULL

      -- table.alter.add_column
      ALTER TABLE public.t_fmt ADD COLUMN new_col text DEFAULT 'new' NOT NULL

      -- table.alter.drop_column
      ALTER TABLE public.t_fmt DROP COLUMN status

      -- table.alter.column_type
      ALTER TABLE public.t_fmt ALTER COLUMN status TYPE varchar(32) COLLATE "en_US"

      -- table.alter.column_set_default
      ALTER TABLE public.t_fmt ALTER COLUMN created_at SET DEFAULT now()

      -- table.alter.column_drop_default
      ALTER TABLE public.t_fmt ALTER COLUMN status DROP DEFAULT

      -- table.alter.column_set_not_null
      ALTER TABLE public.t_fmt ALTER COLUMN status SET NOT NULL

      -- table.alter.column_drop_not_null
      ALTER TABLE public.t_fmt ALTER COLUMN status DROP NOT NULL

      -- table.alter.attach_partition
      ALTER TABLE public.t_parent ATTACH PARTITION public.t_child_1 FOR VALUES FROM (1) TO (100)

      -- table.alter.detach_partition
      ALTER TABLE public.t_parent DETACH PARTITION public.t_child_1

      -- table.comment.create
      COMMENT ON TABLE public.t_fmt IS 'table comment'

      -- table.comment.drop
      COMMENT ON TABLE public.t_fmt IS NULL

      -- table.comment.column.create
      COMMENT ON COLUMN public.t_fmt.id IS 'id column'

      -- table.comment.column.drop
      COMMENT ON COLUMN public.t_fmt.id IS NULL

      -- table.comment.constraint.create
      COMMENT ON CONSTRAINT chk_positive ON public.t_fmt IS 'constraint comment'

      -- table.comment.constraint.drop
      COMMENT ON CONSTRAINT chk_positive ON public.t_fmt IS NULL

      -- table.privilege.grant
      GRANT SELECT (id) ON public.t_fmt TO app_user

      -- table.privilege.revoke
      REVOKE SELECT (id) ON public.t_fmt FROM app_user

      -- table.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.t_fmt FROM app_user

      -- table.drop
      DROP TABLE public.t_fmt

      -- sequence.create
      CREATE SEQUENCE public.s_all
      AS integer
      INCREMENT BY 2
      MINVALUE 5
      MAXVALUE 100
      START WITH 10
      CACHE 3
      CYCLE

      -- sequence.alter.owned_by
      ALTER SEQUENCE public.s_all OWNED BY public.t_fmt.id

      -- sequence.alter.options
      ALTER SEQUENCE public.s_all INCREMENT BY 2 MINVALUE 1 MAXVALUE 100

      -- sequence.comment.create
      COMMENT ON SEQUENCE public.s_all IS 'sequence comment'

      -- sequence.comment.drop
      COMMENT ON SEQUENCE public.s_all IS NULL

      -- sequence.privilege.grant
      GRANT USAGE ON SEQUENCE public.s_all TO app_user

      -- sequence.privilege.revoke
      REVOKE USAGE ON SEQUENCE public.s_all FROM app_user

      -- sequence.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR USAGE ON SEQUENCE public.s_all FROM app_user

      -- sequence.drop
      DROP SEQUENCE public.s_all"
    `);
  });
});
