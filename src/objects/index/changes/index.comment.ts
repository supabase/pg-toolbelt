import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Index } from "../index.model.ts";

/**
 * Create/drop comments on indexes.
 */
export class CreateCommentOnIndex extends CreateChange {
  public readonly index: Index;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get dependencies() {
    return [
      `comment:${this.index.schema}.${this.index.table_name}.${this.index.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON INDEX",
      `${this.index.schema}.${this.index.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: index comment is not nullable here
      quoteLiteral(this.index.comment!),
    ].join(" ");
  }
}

export class DropCommentOnIndex extends DropChange {
  public readonly index: Index;

  constructor(props: { index: Index }) {
    super();
    this.index = props.index;
  }

  get dependencies() {
    return [
      `comment:${this.index.schema}.${this.index.table_name}.${this.index.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON INDEX",
      `${this.index.schema}.${this.index.name}`,
      "IS NULL",
    ].join(" ");
  }
}
