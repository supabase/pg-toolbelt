import { quoteLiteral } from "../../../base.change.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignDataWrapper } from "../foreign-data-wrapper.model.ts";
import {
  CreateForeignDataWrapperChange,
  DropForeignDataWrapperChange,
} from "./foreign-data-wrapper.base.ts";

/**
 * Create/drop comments on foreign data wrappers.
 */

export type CommentForeignDataWrapper =
  | CreateCommentOnForeignDataWrapper
  | DropCommentOnForeignDataWrapper;

export class CreateCommentOnForeignDataWrapper extends CreateForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly scope = "comment" as const;

  constructor(props: { foreignDataWrapper: ForeignDataWrapper }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
  }

  get creates() {
    return [stableId.comment(this.foreignDataWrapper.stableId)];
  }

  get requires() {
    return [this.foreignDataWrapper.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("FOREIGN DATA WRAPPER"),
      this.foreignDataWrapper.name,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: comment is not nullable in this case
      quoteLiteral(this.foreignDataWrapper.comment!),
    );
  }
}

export class DropCommentOnForeignDataWrapper extends DropForeignDataWrapperChange {
  public readonly foreignDataWrapper: ForeignDataWrapper;
  public readonly scope = "comment" as const;

  constructor(props: { foreignDataWrapper: ForeignDataWrapper }) {
    super();
    this.foreignDataWrapper = props.foreignDataWrapper;
  }

  get drops() {
    return [stableId.comment(this.foreignDataWrapper.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.foreignDataWrapper.stableId),
      this.foreignDataWrapper.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("FOREIGN DATA WRAPPER"),
      this.foreignDataWrapper.name,
      ctx.keyword("IS NULL"),
    );
  }
}
