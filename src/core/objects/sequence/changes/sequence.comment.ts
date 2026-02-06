import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Sequence } from "../sequence.model.ts";
import { CreateSequenceChange, DropSequenceChange } from "./sequence.base.ts";

export type CommentSequence = CreateCommentOnSequence | DropCommentOnSequence;

export class CreateCommentOnSequence extends CreateSequenceChange {
  public readonly sequence: Sequence;
  public readonly scope = "comment" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get creates() {
    return [stableId.comment(this.sequence.stableId)];
  }

  get requires() {
    return [this.sequence.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON SEQUENCE"),
      `${this.sequence.schema}.${this.sequence.name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: sequence comment is not nullable in this case
      quoteLiteral(this.sequence.comment!),
    );
  }
}

export class DropCommentOnSequence extends DropSequenceChange {
  public readonly sequence: Sequence;
  public readonly scope = "comment" as const;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get drops() {
    return [stableId.comment(this.sequence.stableId)];
  }

  get requires() {
    return [stableId.comment(this.sequence.stableId), this.sequence.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON SEQUENCE"),
      `${this.sequence.schema}.${this.sequence.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}
