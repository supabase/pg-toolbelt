import { describe, expect, test } from "bun:test";
import { DefaultPrivilegeState } from "../base.default-privileges.ts";
import type { Table } from "../table/table.model.ts";
import {
  AlterSequenceSetOptions,
  AlterSequenceSetOwnedBy,
} from "./changes/sequence.alter.ts";
import {
  CreateCommentOnSequence,
  DropCommentOnSequence,
} from "./changes/sequence.comment.ts";
import { CreateSequence } from "./changes/sequence.create.ts";
import { DropSequence } from "./changes/sequence.drop.ts";
import {
  GrantSequencePrivileges,
  RevokeGrantOptionSequencePrivileges,
  RevokeSequencePrivileges,
} from "./changes/sequence.privilege.ts";
import { diffSequences } from "./sequence.diff.ts";
import { Sequence, type SequenceProps } from "./sequence.model.ts";

const base: SequenceProps = {
  schema: "public",
  name: "seq1",
  data_type: "bigint",
  start_value: 1,
  minimum_value: 1n,
  maximum_value: 1000n,
  increment: 1,
  cycle_option: false,
  cache_size: 1,
  persistence: "p",
  owned_by_schema: null,
  owned_by_table: null,
  owned_by_column: null,
  comment: null,
  privileges: [],
  owner: "test",
};

const testContext = {
  version: 170000,
  currentUser: "postgres",
  defaultPrivilegeState: new DefaultPrivilegeState({}),
  mainRoles: {},
};

describe.concurrent("sequence.diff", () => {
  test("create and drop", () => {
    const s = new Sequence(base);
    const created = diffSequences(testContext, {}, { [s.stableId]: s });
    expect(created[0]).toBeInstanceOf(CreateSequence);
    const dropped = diffSequences(testContext, { [s.stableId]: s }, {});
    expect(dropped[0]).toBeInstanceOf(DropSequence);
  });

  test("alter owned by", () => {
    const main = new Sequence(base);
    const branch = new Sequence({
      ...base,
      owned_by_schema: "public",
      owned_by_table: "t",
      owned_by_column: "id",
    });
    const changes = diffSequences(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterSequenceSetOwnedBy);
  });

  test("alter options via diff", () => {
    const main = new Sequence(base);
    const branch = new Sequence({
      ...base,
      increment: 2,
      minimum_value: 5n,
      maximum_value: 500n,
      start_value: 10,
      cache_size: 3,
      cycle_option: true,
    });
    const changes = diffSequences(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof AlterSequenceSetOptions)).toBe(
      true,
    );
  });

  test("drop and create when non-alterable property changes", () => {
    const main = new Sequence(base);
    const branch = new Sequence({
      ...base,
      data_type: "integer",
      persistence: "u",
    });
    const changes = diffSequences(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(DropSequence);
    expect(changes[1]).toBeInstanceOf(CreateSequence);
  });

  test("skip DROP SEQUENCE when owned by table being dropped", () => {
    const ownedSequence = new Sequence({
      ...base,
      owned_by_schema: "public",
      owned_by_table: "users",
      owned_by_column: "id",
    });
    // When the owning table is not in branch catalog (being dropped),
    // DROP SEQUENCE should not be generated (PostgreSQL auto-drops it)
    const changes = diffSequences(
      testContext,
      { [ownedSequence.stableId]: ownedSequence },
      {}, // branch has no sequences (sequence was auto-dropped)
      {}, // branch has no tables (table is being dropped)
    );
    // Should not generate DROP SEQUENCE since table is being dropped
    expect(changes).toHaveLength(0);
  });

  test("generate DROP SEQUENCE when owned by table that still exists", () => {
    const ownedSequence = new Sequence({
      ...base,
      owned_by_schema: "public",
      owned_by_table: "users",
      owned_by_column: "id",
    });
    // When the owning table still exists in branch catalog,
    // DROP SEQUENCE should be generated
    const changes = diffSequences(
      testContext,
      { [ownedSequence.stableId]: ownedSequence },
      {}, // branch has no sequences
      {
        "table:public.users": {} as Table, // table still exists
      },
    );
    // Should generate DROP SEQUENCE since table still exists
    expect(changes).toHaveLength(1);
    expect(changes[0]).toBeInstanceOf(DropSequence);
  });

  test("create with comment emits CreateCommentOnSequence", () => {
    const s = new Sequence({ ...base, comment: "my seq" });
    const changes = diffSequences(testContext, {}, { [s.stableId]: s });
    expect(changes[0]).toBeInstanceOf(CreateSequence);
    expect(changes.some((c) => c instanceof CreateCommentOnSequence)).toBe(
      true,
    );
  });

  test("create with owned-by emits AlterSequenceSetOwnedBy", () => {
    const s = new Sequence({
      ...base,
      owned_by_schema: "public",
      owned_by_table: "t",
      owned_by_column: "id",
    });
    const changes = diffSequences(testContext, {}, { [s.stableId]: s });
    expect(changes[0]).toBeInstanceOf(CreateSequence);
    expect(changes.some((c) => c instanceof AlterSequenceSetOwnedBy)).toBe(
      true,
    );
  });

  test("create with privileges emits grant, revoke, and revoke grant option", () => {
    const dpState = new DefaultPrivilegeState({});
    dpState.applyGrant("postgres", "S", null, "role_revoke_me", [
      { privilege: "USAGE", grantable: false },
    ]);
    dpState.applyGrant("postgres", "S", null, "role_downgrade", [
      { privilege: "USAGE", grantable: true },
    ]);
    const ctx = { ...testContext, defaultPrivilegeState: dpState };
    const s = new Sequence({
      ...base,
      privileges: [
        { grantee: "role_grant_me", privilege: "USAGE", grantable: false },
        { grantee: "role_downgrade", privilege: "USAGE", grantable: false },
      ],
    });
    const changes = diffSequences(ctx, {}, { [s.stableId]: s });
    expect(changes[0]).toBeInstanceOf(CreateSequence);
    expect(changes.some((c) => c instanceof GrantSequencePrivileges)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof RevokeSequencePrivileges)).toBe(
      true,
    );
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionSequencePrivileges),
    ).toBe(true);
  });

  test("alter comment emits create and drop comment", () => {
    const main = new Sequence(base);
    const withComment = new Sequence({ ...base, comment: "my seq" });

    const addComment = diffSequences(
      testContext,
      { [main.stableId]: main },
      { [withComment.stableId]: withComment },
    );
    expect(addComment[0]).toBeInstanceOf(CreateCommentOnSequence);

    const dropComment = diffSequences(
      testContext,
      { [withComment.stableId]: withComment },
      { [main.stableId]: main },
    );
    expect(dropComment[0]).toBeInstanceOf(DropCommentOnSequence);
  });

  test("alter privileges emits grant, revoke, and revoke grant option", () => {
    const main = new Sequence({
      ...base,
      privileges: [
        { grantee: "role_a", privilege: "USAGE", grantable: false },
        { grantee: "role_b", privilege: "USAGE", grantable: true },
        { grantee: "role_removed", privilege: "USAGE", grantable: false },
      ],
    });
    const branch = new Sequence({
      ...base,
      privileges: [
        { grantee: "role_a", privilege: "USAGE", grantable: true },
        { grantee: "role_b", privilege: "USAGE", grantable: false },
        { grantee: "role_new", privilege: "USAGE", grantable: false },
      ],
    });

    const changes = diffSequences(
      testContext,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes.some((c) => c instanceof GrantSequencePrivileges)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof RevokeSequencePrivileges)).toBe(
      true,
    );
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionSequencePrivileges),
    ).toBe(true);
  });
});
