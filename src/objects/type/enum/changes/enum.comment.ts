import { quoteLiteral } from "../../../base.change.ts";
import type { Enum } from "../enum.model.ts";
import { CreateEnumChange, DropEnumChange } from "./enum.base.ts";

/**
 * Create/drop comments on enum types.
 */

export type CommentEnum = CreateCommentOnEnum | DropCommentOnEnum;

export class CreateCommentOnEnum extends CreateEnumChange {
  public readonly enum: Enum;
  public readonly scope = "comment" as const;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get dependencies() {
    return [`comment:${this.enum.schema}.${this.enum.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.enum.schema}.${this.enum.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: enum comment is not nullable in this case
      quoteLiteral(this.enum.comment!),
    ].join(" ");
  }
}

export class DropCommentOnEnum extends DropEnumChange {
  public readonly enum: Enum;
  public readonly scope = "comment" as const;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get dependencies() {
    return [`comment:${this.enum.schema}.${this.enum.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.enum.schema}.${this.enum.name}`,
      "IS NULL",
    ].join(" ");
  }
}
