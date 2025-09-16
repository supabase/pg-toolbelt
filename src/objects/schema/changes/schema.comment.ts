import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Schema } from "../schema.model.ts";

export class CreateCommentOnSchema extends CreateChange {
  public readonly schemaObj: Schema;

  constructor(props: { schemaObj: Schema }) {
    super();
    this.schemaObj = props.schemaObj;
  }

  get dependencies() {
    return [`comment:${this.schemaObj.schema}`];
  }

  serialize(): string {
    return [
      "COMMENT ON SCHEMA",
      this.schemaObj.schema,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: schema comment is not nullable in this case
      quoteLiteral(this.schemaObj.comment!),
    ].join(" ");
  }
}

export class DropCommentOnSchema extends DropChange {
  public readonly schemaObj: Schema;

  constructor(props: { schemaObj: Schema }) {
    super();
    this.schemaObj = props.schemaObj;
  }

  get dependencies() {
    return [`comment:${this.schemaObj.schema}`];
  }

  serialize(): string {
    return ["COMMENT ON SCHEMA", this.schemaObj.schema, "IS NULL"].join(" ");
  }
}
