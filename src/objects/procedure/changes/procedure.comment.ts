import { BaseChange, quoteLiteral } from "../../base.change.ts";
import type { Procedure } from "../procedure.model.ts";

export type CommentProcedure =
  | CreateCommentOnProcedure
  | DropCommentOnProcedure;

/**
 * Create/drop comments on procedures/functions.
 */
export class CreateCommentOnProcedure extends BaseChange {
  public readonly procedure: Procedure;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "procedure" as const;

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

export class DropCommentOnProcedure extends BaseChange {
  public readonly procedure: Procedure;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "procedure" as const;

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
