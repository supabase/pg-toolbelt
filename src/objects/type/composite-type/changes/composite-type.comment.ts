import {
  CreateChange,
  DropChange,
  quoteLiteral,
} from "../../../base.change.ts";
import type { ColumnProps } from "../../../base.model.ts";
import type { CompositeType } from "../composite-type.model.ts";

/**
 * Create/drop comments on composite types or their attributes.
 *
 * @see https://www.postgresql.org/docs/17/sql-comment.html
 */

export class CreateCommentOnCompositeType extends CreateChange {
  public readonly compositeType: CompositeType;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get dependencies() {
    return [`comment:${this.compositeType.schema}.${this.compositeType.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: type comment is not nullable in this case
      quoteLiteral(this.compositeType.comment!),
    ].join(" ");
  }
}

export class DropCommentOnCompositeType extends DropChange {
  public readonly compositeType: CompositeType;

  constructor(props: { compositeType: CompositeType }) {
    super();
    this.compositeType = props.compositeType;
  }

  get dependencies() {
    return [`comment:${this.compositeType.schema}.${this.compositeType.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TYPE",
      `${this.compositeType.schema}.${this.compositeType.name}`,
      "IS NULL",
    ].join(" ");
  }
}

export class CreateCommentOnCompositeTypeAttribute extends CreateChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: ColumnProps;

  constructor(props: { compositeType: CompositeType; attribute: ColumnProps }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get dependencies() {
    return [
      `comment:${this.compositeType.schema}.${this.compositeType.name}.${this.attribute.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.compositeType.schema}.${this.compositeType.name}.${this.attribute.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: attribute comment is not nullable in this case
      quoteLiteral(this.attribute.comment!),
    ].join(" ");
  }
}

export class DropCommentOnCompositeTypeAttribute extends DropChange {
  public readonly compositeType: CompositeType;
  public readonly attribute: ColumnProps;

  constructor(props: { compositeType: CompositeType; attribute: ColumnProps }) {
    super();
    this.compositeType = props.compositeType;
    this.attribute = props.attribute;
  }

  get dependencies() {
    return [
      `comment:${this.compositeType.schema}.${this.compositeType.name}.${this.attribute.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.compositeType.schema}.${this.compositeType.name}.${this.attribute.name}`,
      "IS NULL",
    ].join(" ");
  }
}
