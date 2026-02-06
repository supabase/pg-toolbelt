import { describe, expect, test } from "vitest";
import {
  type ChangeCase,
  column,
  formatCases,
  index,
  materializedView,
  pgVersion,
  priv,
  renderChanges,
  view,
} from "./fixtures.ts";
import {
  AlterViewChangeOwner,
  AlterViewResetOptions,
  AlterViewSetOptions,
} from "../../../src/core/objects/view/changes/view.alter.ts";
import { CreateView } from "../../../src/core/objects/view/changes/view.create.ts";
import {
  CreateCommentOnView,
  DropCommentOnView,
} from "../../../src/core/objects/view/changes/view.comment.ts";
import { DropView } from "../../../src/core/objects/view/changes/view.drop.ts";
import {
  GrantViewPrivileges,
  RevokeGrantOptionViewPrivileges,
  RevokeViewPrivileges,
} from "../../../src/core/objects/view/changes/view.privilege.ts";
import {
  AlterMaterializedViewChangeOwner,
  AlterMaterializedViewSetStorageParams,
} from "../../../src/core/objects/materialized-view/changes/materialized-view.alter.ts";
import { CreateMaterializedView } from "../../../src/core/objects/materialized-view/changes/materialized-view.create.ts";
import {
  CreateCommentOnMaterializedView,
  CreateCommentOnMaterializedViewColumn,
  DropCommentOnMaterializedView,
  DropCommentOnMaterializedViewColumn,
} from "../../../src/core/objects/materialized-view/changes/materialized-view.comment.ts";
import { DropMaterializedView } from "../../../src/core/objects/materialized-view/changes/materialized-view.drop.ts";
import {
  GrantMaterializedViewPrivileges,
  RevokeGrantOptionMaterializedViewPrivileges,
  RevokeMaterializedViewPrivileges,
} from "../../../src/core/objects/materialized-view/changes/materialized-view.privilege.ts";
import {
  AlterIndexSetStorageParams,
  AlterIndexSetStatistics,
  AlterIndexSetTablespace,
} from "../../../src/core/objects/index/changes/index.alter.ts";
import { CreateIndex } from "../../../src/core/objects/index/changes/index.create.ts";
import {
  CreateCommentOnIndex,
  DropCommentOnIndex,
} from "../../../src/core/objects/index/changes/index.comment.ts";
import { DropIndex } from "../../../src/core/objects/index/changes/index.drop.ts";

const changes: ChangeCase[] = [
  { label: "view.create", change: new CreateView({ view }) },
  {
    label: "view.alter.owner",
    change: new AlterViewChangeOwner({ view, owner: "owner2" }),
  },
  {
    label: "view.alter.set_options",
    change: new AlterViewSetOptions({
      view,
      options: ["security_barrier=true", "check_option=local"],
    }),
  },
  {
    label: "view.alter.reset_options",
    change: new AlterViewResetOptions({
      view,
      params: ["security_barrier", "check_option"],
    }),
  },
  { label: "view.comment.create", change: new CreateCommentOnView({ view }) },
  { label: "view.comment.drop", change: new DropCommentOnView({ view }) },
  {
    label: "view.privilege.grant",
    change: new GrantViewPrivileges({
      view,
      grantee: "app_user",
      privileges: [priv("SELECT")],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  {
    label: "view.privilege.revoke",
    change: new RevokeViewPrivileges({
      view,
      grantee: "app_user",
      privileges: [priv("SELECT")],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  {
    label: "view.privilege.revoke_grant_option",
    change: new RevokeGrantOptionViewPrivileges({
      view,
      grantee: "app_user",
      privilegeNames: ["SELECT"],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  { label: "view.drop", change: new DropView({ view }) },

  {
    label: "materialized_view.create",
    change: new CreateMaterializedView({ materializedView }),
  },
  {
    label: "materialized_view.alter.owner",
    change: new AlterMaterializedViewChangeOwner({
      materializedView,
      owner: "owner2",
    }),
  },
  {
    label: "materialized_view.alter.storage_params",
    change: new AlterMaterializedViewSetStorageParams({
      materializedView,
      paramsToSet: ["fillfactor=90"],
      keysToReset: ["autovacuum_enabled"],
    }),
  },
  {
    label: "materialized_view.comment.create",
    change: new CreateCommentOnMaterializedView({ materializedView }),
  },
  {
    label: "materialized_view.comment.drop",
    change: new DropCommentOnMaterializedView({ materializedView }),
  },
  {
    label: "materialized_view.comment.column.create",
    change: new CreateCommentOnMaterializedViewColumn({
      materializedView,
      column: materializedView.columns[0],
    }),
  },
  {
    label: "materialized_view.comment.column.drop",
    change: new DropCommentOnMaterializedViewColumn({
      materializedView,
      column: materializedView.columns[0],
    }),
  },
  {
    label: "materialized_view.privilege.grant",
    change: new GrantMaterializedViewPrivileges({
      materializedView,
      grantee: "app_user",
      privileges: [priv("SELECT")],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  {
    label: "materialized_view.privilege.revoke",
    change: new RevokeMaterializedViewPrivileges({
      materializedView,
      grantee: "app_user",
      privileges: [priv("SELECT")],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  {
    label: "materialized_view.privilege.revoke_grant_option",
    change: new RevokeGrantOptionMaterializedViewPrivileges({
      materializedView,
      grantee: "app_user",
      privilegeNames: ["SELECT"],
      columns: ["id"],
      version: pgVersion,
    }),
  },
  { label: "materialized_view.drop", change: new DropMaterializedView({ materializedView }) },

  {
    label: "index.create (definition)",
    change: new CreateIndex({
      index,
      indexableObject: { columns: [column({ name: "id" })] },
    }),
  },
  {
    label: "index.alter.storage_params",
    change: new AlterIndexSetStorageParams({
      index,
      paramsToSet: ["fillfactor=80"],
      keysToReset: ["fastupdate"],
    }),
  },
  {
    label: "index.alter.statistics",
    change: new AlterIndexSetStatistics({
      index,
      columnTargets: [{ columnNumber: 1, statistics: 100 }],
    }),
  },
  {
    label: "index.alter.tablespace",
    change: new AlterIndexSetTablespace({ index, tablespace: "fastspace" }),
  },
  { label: "index.comment.create", change: new CreateCommentOnIndex({ index }) },
  { label: "index.comment.drop", change: new DropCommentOnIndex({ index }) },
  { label: "index.drop", change: new DropIndex({ index }) },
];

describe("format options: view + materialized view + index", () => {
  const [formatOff, formatPrettyUpper, formatPrettyLowerLeading, formatPrettyNarrow, formatPrettyPreserve] =
    formatCases;

  test(formatOff.header, () => {
    const output = `${formatOff.header}\n\n${renderChanges(
      changes,
      formatOff.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: off

      -- view.create
      CREATE VIEW public.test_view WITH (security_barrier=true, check_option=local) AS SELECT *
      FROM test_table

      -- view.alter.owner
      ALTER VIEW public.test_view OWNER TO owner2

      -- view.alter.set_options
      ALTER VIEW public.test_view SET (security_barrier=true, check_option=local)

      -- view.alter.reset_options
      ALTER VIEW public.test_view RESET (security_barrier, check_option)

      -- view.comment.create
      COMMENT ON VIEW public.test_view IS 'view comment'

      -- view.comment.drop
      COMMENT ON VIEW public.test_view IS NULL

      -- view.privilege.grant
      GRANT SELECT (id) ON public.test_view TO app_user

      -- view.privilege.revoke
      REVOKE SELECT (id) ON public.test_view FROM app_user

      -- view.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.test_view FROM app_user

      -- view.drop
      DROP VIEW public.test_view

      -- materialized_view.create
      CREATE MATERIALIZED VIEW public.test_mv WITH (fillfactor=90, autovacuum_enabled=false) AS SELECT * FROM test_table WITH DATA

      -- materialized_view.alter.owner
      ALTER MATERIALIZED VIEW public.test_mv OWNER TO owner2

      -- materialized_view.alter.storage_params
      ALTER MATERIALIZED VIEW public.test_mv RESET (autovacuum_enabled); ALTER MATERIALIZED VIEW public.test_mv SET (fillfactor=90)

      -- materialized_view.comment.create
      COMMENT ON MATERIALIZED VIEW public.test_mv IS 'mat view comment'

      -- materialized_view.comment.drop
      COMMENT ON MATERIALIZED VIEW public.test_mv IS NULL

      -- materialized_view.comment.column.create
      COMMENT ON COLUMN public.test_mv.id IS 'mv col'

      -- materialized_view.comment.column.drop
      COMMENT ON COLUMN public.test_mv.id IS NULL

      -- materialized_view.privilege.grant
      GRANT SELECT (id) ON public.test_mv TO app_user

      -- materialized_view.privilege.revoke
      REVOKE SELECT (id) ON public.test_mv FROM app_user

      -- materialized_view.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.test_mv FROM app_user

      -- materialized_view.drop
      DROP MATERIALIZED VIEW public.test_mv

      -- index.create (definition)
      CREATE INDEX test_index ON public.test_table (id)

      -- index.alter.storage_params
      ALTER INDEX public.test_index RESET (fastupdate);
      ALTER INDEX public.test_index SET (fillfactor=80)

      -- index.alter.statistics
      ALTER INDEX public.test_index ALTER COLUMN 1 SET STATISTICS 100

      -- index.alter.tablespace
      ALTER INDEX public.test_index SET TABLESPACE fastspace

      -- index.comment.create
      COMMENT ON INDEX public.test_index IS 'index comment'

      -- index.comment.drop
      COMMENT ON INDEX public.test_index IS NULL

      -- index.drop
      DROP INDEX public.test_index"
    `);
  });

  test(formatPrettyUpper.header, () => {
    const output = `${formatPrettyUpper.header}\n\n${renderChanges(
      changes,
      formatPrettyUpper.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true }

      -- view.create
      CREATE VIEW public.test_view
      WITH (security_barrier=true, check_option=local)
      AS
      SELECT *
      FROM test_table

      -- view.alter.owner
      ALTER VIEW public.test_view OWNER TO owner2

      -- view.alter.set_options
      ALTER VIEW public.test_view SET (security_barrier=true, check_option=local)

      -- view.alter.reset_options
      ALTER VIEW public.test_view RESET (security_barrier, check_option)

      -- view.comment.create
      COMMENT ON VIEW public.test_view IS 'view comment'

      -- view.comment.drop
      COMMENT ON VIEW public.test_view IS NULL

      -- view.privilege.grant
      GRANT SELECT (id) ON public.test_view TO app_user

      -- view.privilege.revoke
      REVOKE SELECT (id) ON public.test_view FROM app_user

      -- view.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.test_view FROM app_user

      -- view.drop
      DROP VIEW public.test_view

      -- materialized_view.create
      CREATE MATERIALIZED VIEW public.test_mv
      WITH (fillfactor=90, autovacuum_enabled=false)
      AS
      SELECT * FROM test_table
      WITH DATA

      -- materialized_view.alter.owner
      ALTER MATERIALIZED VIEW public.test_mv OWNER TO owner2

      -- materialized_view.alter.storage_params
      ALTER MATERIALIZED VIEW public.test_mv RESET (autovacuum_enabled);
      ALTER MATERIALIZED VIEW public.test_mv SET (fillfactor=90)

      -- materialized_view.comment.create
      COMMENT ON MATERIALIZED VIEW public.test_mv IS 'mat view comment'

      -- materialized_view.comment.drop
      COMMENT ON MATERIALIZED VIEW public.test_mv IS NULL

      -- materialized_view.comment.column.create
      COMMENT ON COLUMN public.test_mv.id IS 'mv col'

      -- materialized_view.comment.column.drop
      COMMENT ON COLUMN public.test_mv.id IS NULL

      -- materialized_view.privilege.grant
      GRANT SELECT (id) ON public.test_mv TO app_user

      -- materialized_view.privilege.revoke
      REVOKE SELECT (id) ON public.test_mv FROM app_user

      -- materialized_view.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.test_mv FROM app_user

      -- materialized_view.drop
      DROP MATERIALIZED VIEW public.test_mv

      -- index.create (definition)
      CREATE INDEX test_index ON public.test_table (id)

      -- index.alter.storage_params
      ALTER INDEX public.test_index RESET (fastupdate);
      ALTER INDEX public.test_index SET (fillfactor=80)

      -- index.alter.statistics
      ALTER INDEX public.test_index ALTER COLUMN 1 SET STATISTICS 100

      -- index.alter.tablespace
      ALTER INDEX public.test_index SET TABLESPACE fastspace

      -- index.comment.create
      COMMENT ON INDEX public.test_index IS 'index comment'

      -- index.comment.drop
      COMMENT ON INDEX public.test_index IS NULL

      -- index.drop
      DROP INDEX public.test_index"
    `);
  });

  test(formatPrettyLowerLeading.header, () => {
    const output = `${formatPrettyLowerLeading.header}\n\n${renderChanges(
      changes,
      formatPrettyLowerLeading.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'lower', commaStyle: 'leading', alignColumns: true, indentWidth: 4 }

      -- view.create
      create view public.test_view
      with (security_barrier=true, check_option=local)
      as
      SELECT *
      FROM test_table

      -- view.alter.owner
      alter view public.test_view owner to owner2

      -- view.alter.set_options
      alter view public.test_view set (security_barrier=true, check_option=local)

      -- view.alter.reset_options
      alter view public.test_view reset (security_barrier, check_option)

      -- view.comment.create
      comment on view public.test_view is 'view comment'

      -- view.comment.drop
      comment on view public.test_view is null

      -- view.privilege.grant
      grant select (id) on public.test_view to app_user

      -- view.privilege.revoke
      revoke select (id) on public.test_view from app_user

      -- view.privilege.revoke_grant_option
      revoke grant option for select (id) on public.test_view from app_user

      -- view.drop
      drop view public.test_view

      -- materialized_view.create
      create materialized view public.test_mv
      with (fillfactor=90, autovacuum_enabled=false)
      as
      SELECT * FROM test_table
      with data

      -- materialized_view.alter.owner
      alter materialized view public.test_mv owner to owner2

      -- materialized_view.alter.storage_params
      alter materialized view public.test_mv reset (autovacuum_enabled);
      alter materialized view public.test_mv set (fillfactor=90)

      -- materialized_view.comment.create
      comment on materialized view public.test_mv is 'mat view comment'

      -- materialized_view.comment.drop
      comment on materialized view public.test_mv is null

      -- materialized_view.comment.column.create
      comment on column public.test_mv.id is 'mv col'

      -- materialized_view.comment.column.drop
      comment on column public.test_mv.id is null

      -- materialized_view.privilege.grant
      grant select (id) on public.test_mv to app_user

      -- materialized_view.privilege.revoke
      revoke select (id) on public.test_mv from app_user

      -- materialized_view.privilege.revoke_grant_option
      revoke grant option for select (id) on public.test_mv from app_user

      -- materialized_view.drop
      drop materialized view public.test_mv

      -- index.create (definition)
      CREATE INDEX test_index ON public.test_table (id)

      -- index.alter.storage_params
      alter index public.test_index reset (fastupdate);
      alter index public.test_index set (fillfactor=80)

      -- index.alter.statistics
      alter index public.test_index alter column 1 set statistics 100

      -- index.alter.tablespace
      alter index public.test_index set tablespace fastspace

      -- index.comment.create
      comment on index public.test_index is 'index comment'

      -- index.comment.drop
      comment on index public.test_index is null

      -- index.drop
      drop index public.test_index"
    `);
  });

  test(formatPrettyNarrow.header, () => {
    const output = `${formatPrettyNarrow.header}\n\n${renderChanges(
      changes,
      formatPrettyNarrow.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, lineWidth: 40 }

      -- view.create
      CREATE VIEW public.test_view
      WITH (security_barrier=true,
        check_option=local)
      AS
      SELECT *
      FROM test_table

      -- view.alter.owner
      ALTER VIEW public.test_view OWNER TO
        owner2

      -- view.alter.set_options
      ALTER VIEW public.test_view SET
        (security_barrier=true,
        check_option=local)

      -- view.alter.reset_options
      ALTER VIEW public.test_view RESET
        (security_barrier, check_option)

      -- view.comment.create
      COMMENT ON VIEW public.test_view IS
        'view comment'

      -- view.comment.drop
      COMMENT ON VIEW public.test_view IS NULL

      -- view.privilege.grant
      GRANT SELECT (id) ON public.test_view TO
        app_user

      -- view.privilege.revoke
      REVOKE SELECT (id) ON public.test_view
        FROM app_user

      -- view.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON
        public.test_view FROM app_user

      -- view.drop
      DROP VIEW public.test_view

      -- materialized_view.create
      CREATE MATERIALIZED VIEW public.test_mv
      WITH (fillfactor=90,
        autovacuum_enabled=false)
      AS
      SELECT * FROM test_table
      WITH DATA

      -- materialized_view.alter.owner
      ALTER MATERIALIZED VIEW public.test_mv
        OWNER TO owner2

      -- materialized_view.alter.storage_params
      ALTER MATERIALIZED VIEW public.test_mv
        RESET (autovacuum_enabled);
      ALTER MATERIALIZED VIEW public.test_mv
        SET (fillfactor=90)

      -- materialized_view.comment.create
      COMMENT ON MATERIALIZED VIEW
        public.test_mv IS 'mat view comment'

      -- materialized_view.comment.drop
      COMMENT ON MATERIALIZED VIEW
        public.test_mv IS NULL

      -- materialized_view.comment.column.create
      COMMENT ON COLUMN public.test_mv.id IS
        'mv col'

      -- materialized_view.comment.column.drop
      COMMENT ON COLUMN public.test_mv.id IS
        NULL

      -- materialized_view.privilege.grant
      GRANT SELECT (id) ON public.test_mv TO
        app_user

      -- materialized_view.privilege.revoke
      REVOKE SELECT (id) ON public.test_mv
        FROM app_user

      -- materialized_view.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON
        public.test_mv FROM app_user

      -- materialized_view.drop
      DROP MATERIALIZED VIEW public.test_mv

      -- index.create (definition)
      CREATE INDEX test_index ON public.test_table (id)

      -- index.alter.storage_params
      ALTER INDEX public.test_index RESET
        (fastupdate);
      ALTER INDEX public.test_index SET
        (fillfactor=80)

      -- index.alter.statistics
      ALTER INDEX public.test_index ALTER
        COLUMN 1 SET STATISTICS 100

      -- index.alter.tablespace
      ALTER INDEX public.test_index SET
        TABLESPACE fastspace

      -- index.comment.create
      COMMENT ON INDEX public.test_index IS
        'index comment'

      -- index.comment.drop
      COMMENT ON INDEX public.test_index IS
        NULL

      -- index.drop
      DROP INDEX public.test_index"
    `);
  });

  test(formatPrettyPreserve.header, () => {
    const output = `${formatPrettyPreserve.header}\n\n${renderChanges(
      changes,
      formatPrettyPreserve.options,
    )}`;
    expect(output).toMatchInlineSnapshot(`
      "format: { enabled: true, keywordCase: 'preserve', alignColumns: false, indentWidth: 3 }

      -- view.create
      CREATE VIEW public.test_view
      WITH (security_barrier=true, check_option=local)
      AS
      SELECT *
      FROM test_table

      -- view.alter.owner
      ALTER VIEW public.test_view OWNER TO owner2

      -- view.alter.set_options
      ALTER VIEW public.test_view SET (security_barrier=true, check_option=local)

      -- view.alter.reset_options
      ALTER VIEW public.test_view RESET (security_barrier, check_option)

      -- view.comment.create
      COMMENT ON VIEW public.test_view IS 'view comment'

      -- view.comment.drop
      COMMENT ON VIEW public.test_view IS NULL

      -- view.privilege.grant
      GRANT SELECT (id) ON public.test_view TO app_user

      -- view.privilege.revoke
      REVOKE SELECT (id) ON public.test_view FROM app_user

      -- view.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.test_view FROM app_user

      -- view.drop
      DROP VIEW public.test_view

      -- materialized_view.create
      CREATE MATERIALIZED VIEW public.test_mv
      WITH (fillfactor=90, autovacuum_enabled=false)
      AS
      SELECT * FROM test_table
      WITH DATA

      -- materialized_view.alter.owner
      ALTER MATERIALIZED VIEW public.test_mv OWNER TO owner2

      -- materialized_view.alter.storage_params
      ALTER MATERIALIZED VIEW public.test_mv RESET (autovacuum_enabled);
      ALTER MATERIALIZED VIEW public.test_mv SET (fillfactor=90)

      -- materialized_view.comment.create
      COMMENT ON MATERIALIZED VIEW public.test_mv IS 'mat view comment'

      -- materialized_view.comment.drop
      COMMENT ON MATERIALIZED VIEW public.test_mv IS NULL

      -- materialized_view.comment.column.create
      COMMENT ON COLUMN public.test_mv.id IS 'mv col'

      -- materialized_view.comment.column.drop
      COMMENT ON COLUMN public.test_mv.id IS NULL

      -- materialized_view.privilege.grant
      GRANT SELECT (id) ON public.test_mv TO app_user

      -- materialized_view.privilege.revoke
      REVOKE SELECT (id) ON public.test_mv FROM app_user

      -- materialized_view.privilege.revoke_grant_option
      REVOKE GRANT OPTION FOR SELECT (id) ON public.test_mv FROM app_user

      -- materialized_view.drop
      DROP MATERIALIZED VIEW public.test_mv

      -- index.create (definition)
      CREATE INDEX test_index ON public.test_table (id)

      -- index.alter.storage_params
      ALTER INDEX public.test_index RESET (fastupdate);
      ALTER INDEX public.test_index SET (fillfactor=80)

      -- index.alter.statistics
      ALTER INDEX public.test_index ALTER COLUMN 1 SET STATISTICS 100

      -- index.alter.tablespace
      ALTER INDEX public.test_index SET TABLESPACE fastspace

      -- index.comment.create
      COMMENT ON INDEX public.test_index IS 'index comment'

      -- index.comment.drop
      COMMENT ON INDEX public.test_index IS NULL

      -- index.drop
      DROP INDEX public.test_index"
    `);
  });
});
