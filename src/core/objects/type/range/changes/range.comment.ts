import { quoteLiteral } from "../../../base.change.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../../utils.ts";
import type { Range } from "../range.model.ts";
import { CreateRangeChange, DropRangeChange } from "./range.base.ts";

/**
 * Create/drop comments on range types.
 */

export type CommentRange = CreateCommentOnRange | DropCommentOnRange;

export class CreateCommentOnRange extends CreateRangeChange {
  public readonly range: Range;
  public readonly scope = "comment" as const;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get creates() {
    return [stableId.comment(this.range.stableId)];
  }

  get requires() {
    return [this.range.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("TYPE"),
      `${this.range.schema}.${this.range.name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: range comment is not nullable in this case
      quoteLiteral(this.range.comment!),
    );
  }
}

export class DropCommentOnRange extends DropRangeChange {
  public readonly range: Range;
  public readonly scope = "comment" as const;

  constructor(props: { range: Range }) {
    super();
    this.range = props.range;
  }

  get drops() {
    return [stableId.comment(this.range.stableId)];
  }

  get requires() {
    return [stableId.comment(this.range.stableId), this.range.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("TYPE"),
      `${this.range.schema}.${this.range.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}
