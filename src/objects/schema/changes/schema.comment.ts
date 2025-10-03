import { BaseChange, quoteLiteral } from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";

export type CommentSchema = CreateCommentOnSchema | DropCommentOnSchema;

export class CreateCommentOnSchema extends BaseChange {
  public readonly schema: Schema;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "schema" as const;

  constructor(props: { schema: Schema }) {
    super();
    this.schema = props.schema;
  }

  get dependencies() {
    return [`comment:${this.schema.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON SCHEMA",
      this.schema.name,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: schema comment is not nullable in this case
      quoteLiteral(this.schema.comment!),
    ].join(" ");
  }
}

export class DropCommentOnSchema extends BaseChange {
  public readonly schema: Schema;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "schema" as const;

  constructor(props: { schema: Schema }) {
    super();
    this.schema = props.schema;
  }

  get dependencies() {
    return [`comment:${this.schema.name}`];
  }

  serialize(): string {
    return ["COMMENT ON SCHEMA", this.schema.name, "IS NULL"].join(" ");
  }
}
