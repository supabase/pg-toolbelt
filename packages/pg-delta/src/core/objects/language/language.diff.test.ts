import { describe, expect, test } from "bun:test";
import type { ObjectDiffContext } from "../diff-context.ts";
import { AlterLanguageChangeOwner } from "./changes/language.alter.ts";
import {
  CreateCommentOnLanguage,
  DropCommentOnLanguage,
} from "./changes/language.comment.ts";
import { CreateLanguage } from "./changes/language.create.ts";
import { DropLanguage } from "./changes/language.drop.ts";
import {
  GrantLanguagePrivileges,
  RevokeGrantOptionLanguagePrivileges,
  RevokeLanguagePrivileges,
} from "./changes/language.privilege.ts";
import { diffLanguages } from "./language.diff.ts";
import { Language, type LanguageProps } from "./language.model.ts";

const base: LanguageProps = {
  name: "plpgsql",
  is_trusted: true,
  is_procedural: true,
  call_handler: null,
  inline_handler: null,
  validator: null,
  owner: "o1",
  comment: null,
  privileges: [],
};

const makeLanguage = (override: Partial<LanguageProps> = {}) =>
  new Language({
    ...base,
    ...override,
    privileges: override.privileges ?? [...base.privileges],
  });

const ctx: Pick<ObjectDiffContext, "version"> = {
  version: 170000,
};

describe.concurrent("language.diff", () => {
  test("create and drop", () => {
    const l = new Language(base);
    const created = diffLanguages(ctx, {}, { [l.stableId]: l });
    expect(created[0]).toBeInstanceOf(CreateLanguage);

    const dropped = diffLanguages(ctx, { [l.stableId]: l }, {});
    expect(dropped[0]).toBeInstanceOf(DropLanguage);
  });

  test("alter owner", () => {
    const main = new Language(base);
    const branch = new Language({ ...base, owner: "o2" });
    const changes = diffLanguages(
      ctx,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterLanguageChangeOwner);
  });

  test("drop + create on non-alterable change", () => {
    const main = new Language(base);
    const branch = new Language({ ...base, call_handler: "handler()" });
    const changes = diffLanguages(
      ctx,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(DropLanguage);
    expect(changes[1]).toBeInstanceOf(CreateLanguage);
  });

  test("create with comment emits create comment change", () => {
    const l = makeLanguage({ comment: "my language" });
    const changes = diffLanguages(ctx, {}, { [l.stableId]: l });
    expect(changes[0]).toBeInstanceOf(CreateLanguage);
    expect(changes.some((c) => c instanceof CreateCommentOnLanguage)).toBe(
      true,
    );
  });

  test("comment changes emit create/drop comment statements", () => {
    const main = makeLanguage();
    const withComment = makeLanguage({ comment: "lang comment" });

    const addComment = diffLanguages(
      ctx,
      { [main.stableId]: main },
      { [withComment.stableId]: withComment },
    );
    expect(addComment[0]).toBeInstanceOf(CreateCommentOnLanguage);

    const dropComment = diffLanguages(
      ctx,
      { [withComment.stableId]: withComment },
      { [main.stableId]: main },
    );
    expect(dropComment[0]).toBeInstanceOf(DropCommentOnLanguage);
  });

  test("privilege diffs emit grant, revoke, and revoke grant option statements", () => {
    const main = makeLanguage({
      privileges: [
        { grantee: "role_usage", privilege: "USAGE", grantable: false },
        { grantee: "role_with_option", privilege: "USAGE", grantable: true },
        { grantee: "role_removed", privilege: "USAGE", grantable: false },
      ],
    });
    const branch = makeLanguage({
      privileges: [
        { grantee: "role_usage", privilege: "USAGE", grantable: true },
        { grantee: "role_with_option", privilege: "USAGE", grantable: false },
        { grantee: "role_new", privilege: "USAGE", grantable: false },
      ],
    });

    const changes = diffLanguages(
      ctx,
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );

    expect(changes.some((c) => c instanceof GrantLanguagePrivileges)).toBe(
      true,
    );
    expect(changes.some((c) => c instanceof RevokeLanguagePrivileges)).toBe(
      true,
    );
    expect(
      changes.some((c) => c instanceof RevokeGrantOptionLanguagePrivileges),
    ).toBe(true);
  });
});
