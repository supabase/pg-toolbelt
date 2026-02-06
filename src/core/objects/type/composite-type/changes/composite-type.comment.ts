import { quoteLiteral } from "../../../base.change.ts";
import type { ColumnProps } from "../../../base.model.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../../utils.ts";
import type { CompositeType } from "../composite-type.model.ts";
import {
  CreateCompositeTypeChange,
  DropCompositeTypeChange,
} from "./composite-type.base.ts";

/**
 * Create/drop comments on composite types or their attributes.
 *
 * @see https://www.postgresql.org/docs/17/sql-comment.html
 */

export type CommentCompositeType =
  | CreateCommentOnCompositeType
  | CreateCommentOnCompositeTypeAttribute
  | DropCommentOnCompositeType
  | DropCommentOnCompositeTypeAttribute;

export class CreateCommentOnCompositeType extends CreateCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly scope = "comment" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get creates() {
    return [stableId.comment(this.compositeType.stableId)];
  }

  get requires() {
    return [this.compositeType.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("TYPE"),
      `${this.compositeType.schema}.${this.compositeType.name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: type comment is not nullable in this case
      quoteLiteral(this.compositeType.comment!),
    );
  }
}

export class DropCommentOnCompositeType extends DropCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly scope = "comment" as const;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get drops() {
    return [stableId.comment(this.compositeType.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.compositeType.stableId),
      this.compositeType.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("TYPE"),
      `${this.compositeType.schema}.${this.compositeType.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}

export class CreateCommentOnCompositeTypeAttribute extends CreateCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: ColumnProps;
  public readonly scope = "comment" as const;

  constructor(props: { compositeType: CompositeType; attribute: ColumnProps }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get creates() {
    const attributeStableId = `${this.compositeType.stableId}:${this.attribute.name}`;
    return [stableId.comment(attributeStableId)];
  }

  get requires() {
    return [
      `${this.compositeType.stableId}:${this.attribute.name}`,
      this.compositeType.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("COLUMN"),
      `${this.compositeType.schema}.${this.compositeType.name}.${this.attribute.name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: attribute comment is not nullable in this case
      quoteLiteral(this.attribute.comment!),
    );
  }
}

export class DropCommentOnCompositeTypeAttribute extends DropCompositeTypeChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: ColumnProps;
  public readonly scope = "comment" as const;

  constructor(props: { compositeType: CompositeType; attribute: ColumnProps }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get drops() {
    const attributeStableId = `${this.compositeType.stableId}:${this.attribute.name}`;
    return [stableId.comment(attributeStableId)];
  }

  get requires() {
    const attributeStableId = `${this.compositeType.stableId}:${this.attribute.name}`;
    return [
      stableId.comment(attributeStableId),
      attributeStableId,
      this.compositeType.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("COLUMN"),
      `${this.compositeType.schema}.${this.compositeType.name}.${this.attribute.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}
