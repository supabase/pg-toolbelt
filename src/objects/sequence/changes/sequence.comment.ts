import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Sequence } from "../sequence.model.ts";

export class CreateCommentOnSequence extends CreateChange {
  public readonly sequence: Sequence;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get dependencies() {
    return [`comment:${this.sequence.schema}.${this.sequence.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: sequence comment is not nullable in this case
      quoteLiteral(this.sequence.comment!),
    ].join(" ");
  }
}

export class DropCommentOnSequence extends DropChange {
  public readonly sequence: Sequence;

  constructor(props: { sequence: Sequence }) {
    super();
    this.sequence = props.sequence;
  }

  get dependencies() {
    return [`comment:${this.sequence.schema}.${this.sequence.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON SEQUENCE",
      `${this.sequence.schema}.${this.sequence.name}`,
      "IS NULL",
    ].join(" ");
  }
}
