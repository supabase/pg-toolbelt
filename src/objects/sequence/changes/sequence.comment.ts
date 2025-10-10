import { quoteLiteral } from "../../base.change.ts";
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

export class DropCommentOnSequence extends DropSequenceChange {
  public readonly sequence: Sequence;
  public readonly scope = "comment" as const;

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
