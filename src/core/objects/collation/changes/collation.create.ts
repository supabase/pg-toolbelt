import { SqlFormatter } from "../../../format/index.ts";
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
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const parts: string[] = ["CREATE COLLATION"];

    // Add schema and name (already quoted in model extraction)
    parts.push(`${this.collation.schema}.${this.collation.name}`);

    // Add properties
    const properties: string[] = [];

    // LOCALE
    if (this.collation.locale) {
      properties.push(`LOCALE = ${quoteLiteral(this.collation.locale)}`);
    }

    // LC_COLLATE
    if (this.collation.collate) {
      properties.push(`LC_COLLATE = ${quoteLiteral(this.collation.collate)}`);
    }

    // LC_CTYPE
    if (this.collation.ctype) {
      properties.push(`LC_CTYPE = ${quoteLiteral(this.collation.ctype)}`);
    }

    // PROVIDER
    const providerMap: Record<string, string> = {
      c: "libc",
      i: "icu",
      b: "builtin",
    };
    // provider 'd' means default provider in catalog; omit PROVIDER clause
    if (this.collation.provider !== "d") {
      properties.push(`PROVIDER = ${providerMap[this.collation.provider]}`);
    }

    // DETERMINISTIC
    // DETERMINISTIC (only emit when false; true is default in PG)
    if (this.collation.is_deterministic === false) {
      properties.push(`DETERMINISTIC = false`);
    }

    // RULES (ICU rules)
    if (this.collation.icu_rules) {
      properties.push(`RULES = ${quoteLiteral(this.collation.icu_rules)}`);
    }

    // VERSION
    if (this.collation.version) {
      properties.push(`VERSION = ${quoteLiteral(this.collation.version)}`);
    }

    parts.push(["(", properties.join(", "), ")"].join(""));

    return parts.join(" ");
  }

  private serializeFormatted(formatter: SqlFormatter): string {
    const lines: string[] = [
      `${formatter.keyword("CREATE")} ${formatter.keyword("COLLATION")} ${this.collation.schema}.${this.collation.name}`,
    ];

    const properties: string[] = [];

    if (this.collation.locale) {
      properties.push(
        `${formatter.keyword("LOCALE")} = ${quoteLiteral(this.collation.locale)}`,
      );
    }

    if (this.collation.collate) {
      properties.push(
        `${formatter.keyword("LC_COLLATE")} = ${quoteLiteral(this.collation.collate)}`,
      );
    }

    if (this.collation.ctype) {
      properties.push(
        `${formatter.keyword("LC_CTYPE")} = ${quoteLiteral(this.collation.ctype)}`,
      );
    }

    const providerMap: Record<string, string> = {
      c: "libc",
      i: "icu",
      b: "builtin",
    };
    if (this.collation.provider !== "d") {
      properties.push(
        `${formatter.keyword("PROVIDER")} = ${providerMap[this.collation.provider]}`,
      );
    }

    if (this.collation.is_deterministic === false) {
      properties.push(
        `${formatter.keyword("DETERMINISTIC")} = false`,
      );
    }

    if (this.collation.icu_rules) {
      properties.push(
        `${formatter.keyword("RULES")} = ${quoteLiteral(this.collation.icu_rules)}`,
      );
    }

    if (this.collation.version) {
      properties.push(
        `${formatter.keyword("VERSION")} = ${quoteLiteral(this.collation.version)}`,
      );
    }

    if (properties.length > 0) {
      const list = formatter.list(properties, 1);
      lines.push(
        formatter.parens(`${formatter.indent(1)}${list}`, true),
      );
    } else {
      lines.push("()");
    }

    return lines.join("\n");
  }
}
