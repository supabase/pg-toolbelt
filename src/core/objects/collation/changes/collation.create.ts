import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Collation } from "../collation.model.ts";
import { CreateCollationChange } from "./collation.base.ts";

/**
 * Create a collation.
 *
 * @see https://www.postgresql.org/docs/17/sql-createcollation.html
 *
 * Synopsis
 * ```sql
 * CREATE COLLATION [ IF NOT EXISTS ] name (
 *     [ LOCALE = locale, ]
 *     [ LC_COLLATE = lc_collate, ]
 *     [ LC_CTYPE = lc_ctype, ]
 *     [ PROVIDER = provider, ]
 *     [ DETERMINISTIC = boolean, ]
 *     [ RULES = rules, ]
 *     [ VERSION = version ]
 * )
 *
 * CREATE COLLATION [ IF NOT EXISTS ] name FROM existing_collation
 * ```
 */
export class CreateCollation extends CreateCollationChange {
  public readonly collation: Collation;
  public readonly scope = "object" as const;

  constructor(props: { collation: Collation }) {
    super();
    this.collation = props.collation;
  }

  get creates() {
    return [this.collation.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.collation.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.collation.owner));

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [
      ctx.line(
        ctx.keyword("CREATE"),
        ctx.keyword("COLLATION"),
        `${this.collation.schema}.${this.collation.name}`,
      ),
    ];

    const properties: string[] = [];

    if (this.collation.locale) {
      properties.push(
        `${ctx.keyword("LOCALE")} = ${quoteLiteral(this.collation.locale)}`,
      );
    }

    if (this.collation.collate) {
      properties.push(
        `${ctx.keyword("LC_COLLATE")} = ${quoteLiteral(this.collation.collate)}`,
      );
    }

    if (this.collation.ctype) {
      properties.push(
        `${ctx.keyword("LC_CTYPE")} = ${quoteLiteral(this.collation.ctype)}`,
      );
    }

    const providerMap: Record<string, string> = {
      c: "libc",
      i: "icu",
      b: "builtin",
    };
    if (this.collation.provider !== "d") {
      properties.push(
        `${ctx.keyword("PROVIDER")} = ${providerMap[this.collation.provider]}`,
      );
    }

    if (this.collation.is_deterministic === false) {
      properties.push(`${ctx.keyword("DETERMINISTIC")} = false`);
    }

    if (this.collation.icu_rules) {
      properties.push(
        `${ctx.keyword("RULES")} = ${quoteLiteral(this.collation.icu_rules)}`,
      );
    }

    if (this.collation.version) {
      properties.push(
        `${ctx.keyword("VERSION")} = ${quoteLiteral(this.collation.version)}`,
      );
    }

    if (properties.length > 0) {
      const list = ctx.list(properties, 1);
      lines.push(ctx.parens(`${ctx.indent(1)}${list}`, ctx.pretty));
    } else {
      lines.push("()");
    }

    return ctx.joinLines(lines);
  }
}
