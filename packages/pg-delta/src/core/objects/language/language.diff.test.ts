import { describe, expect, test } from "bun:test";
import { AlterLanguageChangeOwner } from "./changes/language.alter.ts";
import { CreateLanguage } from "./changes/language.create.ts";
import { DropLanguage } from "./changes/language.drop.ts";
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

describe.concurrent("language.diff", () => {
  test("create and drop", () => {
    const l = new Language(base);
    const created = diffLanguages({ version: 170000 }, {}, { [l.stableId]: l });
    expect(created[0]).toBeInstanceOf(CreateLanguage);

    const dropped = diffLanguages({ version: 170000 }, { [l.stableId]: l }, {});
    expect(dropped[0]).toBeInstanceOf(DropLanguage);
  });

  test("alter owner", () => {
    const main = new Language(base);
    const branch = new Language({ ...base, owner: "o2" });
    const changes = diffLanguages(
      { version: 170000 },
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes[0]).toBeInstanceOf(AlterLanguageChangeOwner);
  });

  test("drop + create on non-alterable change", () => {
    const main = new Language(base);
    const branch = new Language({ ...base, call_handler: "handler()" });
    const changes = diffLanguages(
      { version: 170000 },
      { [main.stableId]: main },
      { [branch.stableId]: branch },
    );
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(DropLanguage);
    expect(changes[1]).toBeInstanceOf(CreateLanguage);
  });
});
