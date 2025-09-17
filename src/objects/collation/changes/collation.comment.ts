import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Collation } from "../collation.model.ts";

/**
 * Create/drop comments on collations.
 */
export class CreateCommentOnCollation extends CreateChange {
  public readonly collation: Collation;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get dependencies() {
    return [`comment:${this.collation.schema}.${this.collation.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON COLLATION",
      `${this.collation.schema}.${this.collation.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: collation comment is not nullable in this case
      quoteLiteral(this.collation.comment!),
    ].join(" ");
  }
}

export class DropCommentOnCollation extends DropChange {
  public readonly collation: Collation;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get dependencies() {
    return [`comment:${this.collation.schema}.${this.collation.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON COLLATION",
      `${this.collation.schema}.${this.collation.name}`,
      "IS NULL",
    ].join(" ");
  }
}
