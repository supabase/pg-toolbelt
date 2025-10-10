import { quoteLiteral } from "../../base.change.ts";
import type { Language } from "../language.model.ts";
import { CreateLanguageChange, DropLanguageChange } from "./language.base.ts";

export type CommentLanguage = CreateCommentOnLanguage | DropCommentOnLanguage;

/**
 * Create/drop comments on languages.
 */
export class CreateCommentOnLanguage extends CreateLanguageChange {
  public readonly language: Language;
  public readonly scope = "comment" as const;

  constructor(props: { language: Language }) {
    super();
    this.language = props.language;
  }

  get dependencies() {
    return [`comment:${this.language.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON LANGUAGE",
      this.language.name,
      "IS",
      quoteLiteral(this.language.comment as string),
    ].join(" ");
  }
}

export class DropCommentOnLanguage extends DropLanguageChange {
  public readonly language: Language;
  public readonly scope = "comment" as const;

  constructor(props: { language: Language }) {
    super();
    this.language = props.language;
  }

  get dependencies() {
    return [`comment:${this.language.name}`];
  }

  serialize(): string {
    return ["COMMENT ON LANGUAGE", this.language.name, "IS NULL"].join(" ");
  }
}
