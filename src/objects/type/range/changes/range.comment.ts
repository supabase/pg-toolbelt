import { BaseChange, quoteLiteral } from "../../../base.change.ts";
import type { Range } from "../range.model.ts";

/**
 * Create/drop comments on range types.
 */

export type CommentRange = CreateCommentOnRange | DropCommentOnRange;

export class CreateCommentOnRange extends BaseChange {
  public readonly range: Range;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "range" as const;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get dependencies() {
    return [`comment:${this.range.schema}.${this.range.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.range.schema}.${this.range.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: range comment is not nullable in this case
      quoteLiteral(this.range.comment!),
    ].join(" ");
  }
}

export class DropCommentOnRange extends BaseChange {
  public readonly range: Range;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "range" as const;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get dependencies() {
    return [`comment:${this.range.schema}.${this.range.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.range.schema}.${this.range.name}`,
      "IS NULL",
    ].join(" ");
  }
}
