import { BaseChange, quoteLiteral } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";

export type CommentRlsPolicy =
  | CreateCommentOnRlsPolicy
  | DropCommentOnRlsPolicy;

export class CreateCommentOnRlsPolicy extends BaseChange {
  public readonly policy: RlsPolicy;
  public readonly operation = "create" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { policy: RlsPolicy }) {
    super();
    this.policy = props.policy;
  }

  get dependencies() {
    return [
      `comment:${this.policy.schema}.${this.policy.table_name}.${this.policy.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON POLICY",
      this.policy.name,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: rls policy comment is not nullable in this case
      quoteLiteral(this.policy.comment!),
    ].join(" ");
  }
}

export class DropCommentOnRlsPolicy extends BaseChange {
  public readonly policy: RlsPolicy;
  public readonly operation = "drop" as const;
  public readonly scope = "comment" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { policy: RlsPolicy }) {
    super();
    this.policy = props.policy;
  }

  get dependencies() {
    return [
      `comment:${this.policy.schema}.${this.policy.table_name}.${this.policy.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON POLICY",
      this.policy.name,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
      "IS NULL",
    ].join(" ");
  }
}
