import { describe, expect, test } from "bun:test";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import {
  AlterMaterializedViewChangeOwner,
  AlterMaterializedViewSetStorageParams,
} from "./changes/materialized-view.alter.ts";
import {
  CreateCommentOnMaterializedView,
  CreateCommentOnMaterializedViewColumn,
  DropCommentOnMaterializedView,
  DropCommentOnMaterializedViewColumn,
} from "./changes/materialized-view.comment.ts";
import { CreateMaterializedView } from "./changes/materialized-view.create.ts";
import { DropMaterializedView } from "./changes/materialized-view.drop.ts";
import {
  GrantMaterializedViewPrivileges,
  RevokeGrantOptionMaterializedViewPrivileges,
  RevokeMaterializedViewPrivileges,
} from "./changes/materialized-view.privilege.ts";
import { diffMaterializedViews } from "./materialized-view.diff.ts";
import {
  MaterializedView,
  type MaterializedViewProps,
} from "./materialized-view.model.ts";

const base: MaterializedViewProps = {
  schema: "public",
  name: "mv1",
  definition: "select 1",
  row_security: false,
  force_row_security: false,
  has_indexes: false,
  has_rules: false,
  has_triggers: false,
  has_subclasses: false,
  is_populated: true,
  replica_identity: "d",
  is_partition: false,
  options: null,
  partition_bound: null,
  owner: "o1",
  comment: null,
  columns: [],
  privileges: [],
};

const baseColumn = {
  name: "id",
  position: 1,
  data_type: "integer",
  data_type_str: "integer",
  is_custom_type: false,
  custom_type_type: null,
  custom_type_category: null,
  custom_type_schema: null,
  custom_type_name: null,
  not_null: false,
  is_identity: false,
  is_identity_always: false,
  is_generated: false,
  collation: null,
  default: null,
  comment: null,
};

const makeMaterializedView = (override: Partial<MaterializedViewProps> = {}) =>
  new MaterializedView({
    ...base,
    ...override,
    privileges: override.privileges ?? [...base.privileges],
    columns: override.columns ?? [...base.columns],
  });

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("materialized-view.diff", () => {
  test("create and drop", () => {
    const mv = new MaterializedView(base);
    const created = diffMaterializedViews(
      testContext,
      {},
      { [mv.stableId]: mv },
    );
    expect(created[0]).toBeInstanceOf(CreateMaterializedView);
    const dropped = diffMaterializedViews(
      testContext,
      { [mv.stableId]: mv },
      {},
    );
    expect(dropped[0]).toBeInstanceOf(DropMaterializedView);
  });

  test("alter owner", () => {
    const main = new MaterializedView(base);
    const branch = new MaterializedView({ ...base, owner: "o2" });
    const changes = diffMaterializedViews(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterMaterializedViewChangeOwner);
  });

  test("drop + create on non-alterable change", () => {
    const main = new MaterializedView(base);
    const branch = new MaterializedView({ ...base, definition: "select 2" });
    const changes = diffMaterializedViews(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(DropMaterializedView);
    expect(changes[1]).toBeInstanceOf(CreateMaterializedView);
  });

  test("alter storage parameters: set and reset", () => {
    const main = new MaterializedView({
      ...base,
      options: ["fillfactor=90", "autovacuum_enabled=false"],
    });
    const branch = new MaterializedView({
      ...base,
      options: ["fillfactor=70", "user_catalog_table=true"],
    });
    const changes = diffMaterializedViews(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(
      changes.some((c) => c instanceof AlterMaterializedViewSetStorageParams),
    ).toBe(true);
  });

  test("create with comment and column comments", () => {
    const mv = makeMaterializedView({
      comment: "my matview",
      columns: [
        { ...baseColumn, comment: "id column" },
        { ...baseColumn, name: "val", position: 2, comment: null },
      ],
    });
    const changes = diffMaterializedViews(
      testContext,
      {},
      { [mv.stableId]: mv },
    );
    expect(changes[0]).toBeInstanceOf(CreateMaterializedView);
    expect(
      changes.some((c) => c instanceof CreateCommentOnMaterializedView),
    ).toBe(true);
    expect(
      changes.some((c) => c instanceof CreateCommentOnMaterializedViewColumn),
    ).toBe(true);
  });

  test("create with privileges emits grant changes", () => {
    const mv = makeMaterializedView({
      privileges: [
        { grantee: "role_select", privilege: "SELECT", grantable: false },
      ],
    });
    const changes = diffMaterializedViews(
      testContext,
      {},
      { [mv.stableId]: mv },
    );
    expect(changes[0]).toBeInstanceOf(CreateMaterializedView);
    expect(
      changes.some((c) => c instanceof GrantMaterializedViewPrivileges),
    ).toBe(true);
  });

  test("comment changes emit create/drop comment statements", () => {
    const main = makeMaterializedView();
    const withComment = makeMaterializedView({ comment: "matview comment" });

    const addComment = diffMaterializedViews(
      testContext,
      { [main.stableId]: main },
      { [withComment.stableId]: withComment },
    );
    expect(addComment[0]).toBeInstanceOf(CreateCommentOnMaterializedView);

    const dropComment = diffMaterializedViews(
      testContext,
      { [withComment.stableId]: withComment },
      { [main.stableId]: main },
    );
    expect(dropComment[0]).toBeInstanceOf(DropCommentOnMaterializedView);
  });

  test("column comment changes emit create/drop column comment statements", () => {
    const main = makeMaterializedView({
      columns: [{ ...baseColumn, comment: null }],
    });
    const withColComment = makeMaterializedView({
      columns: [{ ...baseColumn, comment: "id column" }],
    });

    const addColComment = diffMaterializedViews(
      testContext,
      { [main.stableId]: main },
      { [withColComment.stableId]: withColComment },
    );
    expect(
      addColComment.some(
        (c) => c instanceof CreateCommentOnMaterializedViewColumn,
      ),
    ).toBe(true);

    const dropColComment = diffMaterializedViews(
      testContext,
      { [withColComment.stableId]: withColComment },
      { [main.stableId]: main },
    );
    expect(
      dropColComment.some(
        (c) => c instanceof DropCommentOnMaterializedViewColumn,
      ),
    ).toBe(true);
  });

  test("privilege diffs emit grant, revoke, and revoke grant option statements", () => {
    const main = makeMaterializedView({
      privileges: [
        { grantee: "role_select", privilege: "SELECT", grantable: false },
        { grantee: "role_with_option", privilege: "SELECT", grantable: true },
        { grantee: "role_removed", privilege: "SELECT", grantable: false },
      ],
    });
    const branch = makeMaterializedView({
      privileges: [
        { grantee: "role_select", privilege: "SELECT", grantable: true },
        { grantee: "role_with_option", privilege: "SELECT", grantable: false },
        { grantee: "role_new", privilege: "SELECT", grantable: false },
      ],
    });

    const changes = diffMaterializedViews(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(
      changes.some((c) => c instanceof GrantMaterializedViewPrivileges),
    ).toBe(true);
    expect(
      changes.some((c) => c instanceof RevokeMaterializedViewPrivileges),
    ).toBe(true);
    expect(
      changes.some(
        (c) => c instanceof RevokeGrantOptionMaterializedViewPrivileges,
      ),
    ).toBe(true);
  });
});
