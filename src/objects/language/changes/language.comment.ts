import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Language } from "../language.model.ts";

/**
 * Create/drop comments on languages.
 */
export class CreateCommentOnLanguage extends CreateChange {
  public readonly language: Language;

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

export class DropCommentOnLanguage extends DropChange {
  public readonly language: Language;

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
