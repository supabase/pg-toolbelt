import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";

/**
 * Create/drop comments on procedures/functions.
 */
export class CreateCommentOnProcedure extends CreateChange {
  public readonly procedure: Procedure;

  constructor(props: { procedure: Procedure }) {
    super();
    this.procedure = props.procedure;
  }

  get dependencies() {
    return [
      `comment:${this.procedure.schema}.${this.procedure.name}(${(this.procedure.argument_types ?? []).join(",")})`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON",
      this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION",
      `${this.procedure.schema}.${this.procedure.name}(${(this.procedure.argument_types ?? []).join(",")})`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: procedure comment is not nullable in this case
      quoteLiteral(this.procedure.comment!),
    ].join(" ");
  }
}

export class DropCommentOnProcedure extends DropChange {
  public readonly procedure: Procedure;

  constructor(props: { procedure: Procedure }) {
    super();
    this.procedure = props.procedure;
  }

  get dependencies() {
    return [
      `comment:${this.procedure.schema}.${this.procedure.name}(${(this.procedure.argument_types ?? []).join(",")})`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON",
      this.procedure.kind === "p" ? "PROCEDURE" : "FUNCTION",
      `${this.procedure.schema}.${this.procedure.name}(${(this.procedure.argument_types ?? []).join(",")})`,
      "IS NULL",
    ].join(" ");
  }
}
