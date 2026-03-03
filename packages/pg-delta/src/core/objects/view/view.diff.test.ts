import { describe, expect, test } from "bun:test";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import {
  AlterViewChangeOwner,
  AlterViewResetOptions,
  AlterViewSetOptions,
} from "./changes/view.alter.ts";
import {
  CreateCommentOnView,
  DropCommentOnView,
} from "./changes/view.comment.ts";
import { CreateView } from "./changes/view.create.ts";
import { DropView } from "./changes/view.drop.ts";
import {
  GrantViewPrivileges,
  RevokeGrantOptionViewPrivileges,
  RevokeViewPrivileges,
} from "./changes/view.privilege.ts";
import { diffViews } from "./view.diff.ts";
import { View, type ViewProps } from "./view.model.ts";

const base: ViewProps = {
  schema: "public",
  name: "v",
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

const makeView = (override: Partial<ViewProps> = {}) =>
  new View({
    ...base,
    ...override,
    privileges: override.privileges ?? [...base.privileges],
  });

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("view.diff", () => {
  test("create and drop", () => {
    const v = new View(base);
    const created = diffViews(testContext, {}, { [v.stableId]: v });
    expect(created[0]).toBeInstanceOf(CreateView);
    const dropped = diffViews(testContext, { [v.stableId]: v }, {});
    expect(dropped[0]).toBeInstanceOf(DropView);
  });

  test("alter owner", () => {
    const main = new View(base);
    const branch = new View({ ...base, owner: "o2" });
    const changes = diffViews(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterViewChangeOwner);
  });

  test("alter: set and reset options", () => {
    const main = new View({
      ...base,
      options: ["security_barrier=true", "check_option=local"],
    });
    const branch = new View({ ...base, options: ["security_barrier=false"] });
    const changes = diffViews(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterViewSetOptions)).toBe(true);
    expect(changes.some((c) => c instanceof AlterViewResetOptions)).toBe(true);
  });

  test("create or replace when non-alterable property changes", () => {
    const main = new View(base);
    const branch = new View({
      ...base,
      definition: "select 2",
      row_security: true,
    });
    const changes = diffViews(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(CreateView);
  });

  test("create with privileges emits grant changes", () => {
    const v = makeView({
      privileges: [
        { grantee: "role_select", privilege: "SELECT", grantable: false },
      ],
    });
    const changes = diffViews(testContext, {}, { [v.stableId]: v });
    expect(changes[0]).toBeInstanceOf(CreateView);
    expect(changes.some((c) => c instanceof GrantViewPrivileges)).toBe(true);
  });

  test("create with comment emits create comment change", () => {
    const v = makeView({ comment: "my view" });
    const changes = diffViews(testContext, {}, { [v.stableId]: v });
    expect(changes[0]).toBeInstanceOf(CreateView);
    expect(changes.some((c) => c instanceof CreateCommentOnView)).toBe(true);
  });

  test("comment changes emit create/drop comment statements", () => {
    const main = makeView();
    const withComment = makeView({ comment: "view comment" });

    const addComment = diffViews(
      testContext,
      { [main.stableId]: main },
      { [withComment.stableId]: withComment },
    );
    expect(addComment[0]).toBeInstanceOf(CreateCommentOnView);

    const dropComment = diffViews(
      testContext,
      { [withComment.stableId]: withComment },
      { [main.stableId]: main },
    );
    expect(dropComment[0]).toBeInstanceOf(DropCommentOnView);
  });

  test("privilege diffs emit grant, revoke, and revoke grant option statements", () => {
    const main = makeView({
      privileges: [
        { grantee: "role_select", privilege: "SELECT", grantable: false },
        { grantee: "role_with_option", privilege: "SELECT", grantable: true },
        { grantee: "role_removed", privilege: "SELECT", grantable: false },
      ],
    });
    const branch = makeView({
      privileges: [
        { grantee: "role_select", privilege: "SELECT", grantable: true },
        { grantee: "role_with_option", privilege: "SELECT", grantable: false },
        { grantee: "role_new", privilege: "SELECT", grantable: false },
      ],
    });

    const changes = diffViews(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.some((c) => c instanceof GrantViewPrivileges)).toBe(true);
    expect(changes.some((c) => c instanceof RevokeViewPrivileges)).toBe(true);
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionViewPrivileges),
    ).toBe(true);
  });
});
