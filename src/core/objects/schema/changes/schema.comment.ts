import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Schema } from "../schema.model.ts";
import { CreateSchemaChange, DropSchemaChange } from "./schema.base.ts";

export type CommentSchema = CreateCommentOnSchema | DropCommentOnSchema;

export class CreateCommentOnSchema extends CreateSchemaChange {
  public readonly schema: Schema;
  public readonly scope = "comment" as const;

  constructor(props: { schema: Schema }) {
    super();
    this.schema = props.schema;
  }

  get creates() {
    return [stableId.comment(this.schema.stableId)];
  }

  get requires() {
    return [this.schema.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON SCHEMA"),
      this.schema.name,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: schema comment is not nullable in this case
      quoteLiteral(this.schema.comment!),
    );
  }
}

export class DropCommentOnSchema extends DropSchemaChange {
  public readonly schema: Schema;
  public readonly scope = "comment" as const;

  constructor(props: { schema: Schema }) {
    super();
    this.schema = props.schema;
  }

  get drops() {
    return [stableId.comment(this.schema.stableId)];
  }

  get requires() {
    return [stableId.comment(this.schema.stableId), this.schema.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON SCHEMA"),
      this.schema.name,
      ctx.keyword("IS NULL"),
    );
  }
}
