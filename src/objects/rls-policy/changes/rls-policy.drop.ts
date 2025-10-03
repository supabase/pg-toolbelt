import { BaseChange } from "../../base.change.ts";
import type { RlsPolicy } from "../rls-policy.model.ts";

/**
 * Drop an RLS policy.
 *
 * @see https://www.postgresql.org/docs/17/sql-droppolicy.html
 *
 * Synopsis
 * ```sql
 * DROP POLICY [ IF EXISTS ] name ON table_name [ CASCADE | RESTRICT ]
 * ```
 */
export class DropRlsPolicy extends BaseChange {
  public readonly policy: RlsPolicy;
  public readonly operation = "drop" as const;
  public readonly scope = "object" as const;
  public readonly objectType = "rls_policy" as const;

  constructor(props: { policy: RlsPolicy }) {
    super();
    this.policy = props.policy;
  }

  get dependencies() {
    return [this.policy.stableId];
  }

  serialize(): string {
    return [
      "DROP POLICY",
      this.policy.name,
      "ON",
      `${this.policy.schema}.${this.policy.table_name}`,
    ].join(" ");
  }
}
