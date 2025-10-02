import { BaseChange, quoteLiteral } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";

export type CommentRlsPolicy =
  | CreateCommentOnRlsPolicy
  | DropCommentOnRlsPolicy;

export class CreateCommentOnRlsPolicy extends BaseChange {
  public readonly rlsPolicy: RlsPolicy;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { rlsPolicy: RlsPolicy }) {
    super();
    this.rlsPolicy = props.rlsPolicy;
  }

  get dependencies() {
    return [
      `comment:${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}.${this.rlsPolicy.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON POLICY",
      this.rlsPolicy.name,
      "ON",
      `${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: rls policy comment is not nullable in this case
      quoteLiteral(this.rlsPolicy.comment!),
    ].join(" ");
  }
}

export class DropCommentOnRlsPolicy extends BaseChange {
  public readonly rlsPolicy: RlsPolicy;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { rlsPolicy: RlsPolicy }) {
    super();
    this.rlsPolicy = props.rlsPolicy;
  }

  get dependencies() {
    return [
      `comment:${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}.${this.rlsPolicy.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON POLICY",
      this.rlsPolicy.name,
      "ON",
      `${this.rlsPolicy.schema}.${this.rlsPolicy.table_name}`,
      "IS NULL",
    ].join(" ");
  }
}
