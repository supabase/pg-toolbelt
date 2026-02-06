import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { Aggregate } from "../aggregate.model.ts";
import { AlterAggregateChange } from "./aggregate.base.ts";

export type AlterAggregate = AlterAggregateChangeOwner;

/**
 * ALTER AGGREGATE ... OWNER TO ...
 *
 * @see https://www.postgresql.org/docs/17/sql-alteraggregate.html
 */
export class AlterAggregateChangeOwner extends AlterAggregateChange {
  public readonly aggregate: Aggregate;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { aggregate: Aggregate; owner: string }) {
    super();
    this.aggregate = props.aggregate;
    this.owner = props.owner;
  }

  get requires() {
    return [this.aggregate.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const signature = this.aggregate.identityArguments;
    const qualifiedName = `${this.aggregate.schema}.${this.aggregate.name}`;
    const withArgs = signature.length > 0 ? `(${signature})` : "()";
    return ctx.line(
      ctx.keyword("ALTER AGGREGATE"),
      `${qualifiedName}${withArgs}`,
      ctx.keyword("OWNER TO"),
      this.owner,
    );
  }
}
