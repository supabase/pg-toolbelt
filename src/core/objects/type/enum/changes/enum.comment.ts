import { quoteLiteral } from "../../../base.change.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../../utils.ts";
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

  get creates() {
    return [stableId.comment(this.enum.stableId)];
  }

  get requires() {
    return [this.enum.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("TYPE"),
      `${this.enum.schema}.${this.enum.name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: enum comment is not nullable in this case
      quoteLiteral(this.enum.comment!),
    );
  }
}

export class DropCommentOnEnum extends DropEnumChange {
  public readonly enum: Enum;
  public readonly scope = "comment" as const;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get drops() {
    return [stableId.comment(this.enum.stableId)];
  }

  get requires() {
    return [stableId.comment(this.enum.stableId), this.enum.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("TYPE"),
      `${this.enum.schema}.${this.enum.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}
