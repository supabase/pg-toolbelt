import { quoteLiteral } from "../../../base.change.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../../utils.ts";
import type { Enum } from "../enum.model.ts";
import { CreateEnumChange } from "./enum.base.ts";

/**
 * Create an enum.
 *
 * @see https://www.postgresql.org/docs/17/sql-createtype.html
 *
 * Synopsis
 * ```sql
 * CREATE TYPE name AS ENUM ( [ label [, ...] ] )
 * ```
 */
export class CreateEnum extends CreateEnumChange {
  public readonly enum: Enum;
  public readonly scope = "object" as const;

  constructor(props: { enum: Enum }) {
    super();
    this.enum = props.enum;
  }

  get creates() {
    return [this.enum.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.enum.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.enum.owner));

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);

    const head = ctx.line(
      ctx.keyword("CREATE"),
      ctx.keyword("TYPE"),
      `${this.enum.schema}.${this.enum.name}`,
      ctx.keyword("AS"),
      ctx.keyword("ENUM"),
    );

    const labels = this.enum.labels.map((label) => quoteLiteral(label.label));
    const list = ctx.list(labels, 1);
    const body =
      labels.length === 0
        ? "()"
        : ctx.parens(`${ctx.indent(1)}${list}`, ctx.pretty);

    return ctx.line(head, body);
  }
}
