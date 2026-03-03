import { describe, expect, test } from "bun:test";
import { DefaultPrivilegeState } from "../../base.default-privileges.ts";
import { AlterRangeChangeOwner } from "./changes/range.alter.ts";
import {
  CreateCommentOnRange,
  DropCommentOnRange,
} from "./changes/range.comment.ts";
import { CreateRange } from "./changes/range.create.ts";
import { DropRange } from "./changes/range.drop.ts";
import {
  GrantRangePrivileges,
  RevokeGrantOptionRangePrivileges,
  RevokeRangePrivileges,
} from "./changes/range.privilege.ts";
import { diffRanges } from "./range.diff.ts";
import { Range, type RangeProps } from "./range.model.ts";

const base: RangeProps = {
  schema: "public",
  name: "ts_custom",
  owner: "o1",
  subtype_schema: "pg_catalog",
  subtype_str: "int4",
  collation: null,
  canonical_function_schema: null,
  canonical_function_name: null,
  subtype_diff_schema: null,
  subtype_diff_name: null,
  subtype_opclass_schema: null,
  subtype_opclass_name: null,
  comment: null,
  privileges: [],
};

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("range.diff", () => {
  test("create and drop", () => {
    const r = new Range(base);
    const created = diffRanges(testContext, {}, { [r.stableId]: r });
    expect(created[0]).toBeInstanceOf(CreateRange);
    const dropped = diffRanges(testContext, { [r.stableId]: r }, {});
    expect(dropped[0]).toBeInstanceOf(DropRange);
  });

  test("alter owner", () => {
    const main = new Range(base);
    const branch = new Range({ ...base, owner: "o2" });
    const changes = diffRanges(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterRangeChangeOwner);
  });

  test("drop and create when non-alterable property changes", () => {
    const main = new Range(base);
    const branch = new Range({
      ...base,
      subtype_schema: "pg_catalog",
      subtype_str: "text",
      collation: "en_US",
    });
    const changes = diffRanges(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(DropRange);
    expect(changes[1]).toBeInstanceOf(CreateRange);
  });

  test("create with comment emits CreateCommentOnRange", () => {
    const r = new Range({ ...base, comment: "my range" });
    const changes = diffRanges(testContext, {}, { [r.stableId]: r });
    expect(changes[0]).toBeInstanceOf(CreateRange);
    expect(changes.some((c) => c instanceof CreateCommentOnRange)).toBe(true);
  });

  test("create with privileges emits grant changes", () => {
    const r = new Range({
      ...base,
      privileges: [{ grantee: "role_a", privilege: "USAGE", grantable: false }],
    });
    const changes = diffRanges(testContext, {}, { [r.stableId]: r });
    expect(changes[0]).toBeInstanceOf(CreateRange);
    expect(changes.some((c) => c instanceof GrantRangePrivileges)).toBe(true);
  });

  test("alter comment emits create and drop comment", () => {
    const main = new Range(base);
    const withComment = new Range({ ...base, comment: "my range" });

    const addComment = diffRanges(
      testContext,
      { [main.stableId]: main },
      { [withComment.stableId]: withComment },
    );
    expect(addComment.some((c) => c instanceof CreateCommentOnRange)).toBe(
      true,
    );

    const dropComment = diffRanges(
      testContext,
      { [withComment.stableId]: withComment },
      { [main.stableId]: main },
    );
    expect(dropComment.some((c) => c instanceof DropCommentOnRange)).toBe(true);
  });

  test("alter privileges emits grant, revoke, and revoke grant option", () => {
    const main = new Range({
      ...base,
      privileges: [
        { grantee: "role_a", privilege: "USAGE", grantable: false },
        { grantee: "role_b", privilege: "USAGE", grantable: true },
        { grantee: "role_removed", privilege: "USAGE", grantable: false },
      ],
    });
    const branch = new Range({
      ...base,
      privileges: [
        { grantee: "role_a", privilege: "USAGE", grantable: true },
        { grantee: "role_b", privilege: "USAGE", grantable: false },
        { grantee: "role_new", privilege: "USAGE", grantable: false },
      ],
    });

    const changes = diffRanges(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof GrantRangePrivileges)).toBe(true);
    expect(changes.some((c) => c instanceof RevokeRangePrivileges)).toBe(true);
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionRangePrivileges),
    ).toBe(true);
  });
});
