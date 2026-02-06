import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { isUserDefinedTypeSchema, stableId } from "../../utils.ts";
import type { Domain } from "../domain.model.ts";
import { CreateDomainChange } from "./domain.base.ts";

/**
 * Create a domain.
 *
 * @see https://www.postgresql.org/docs/17/sql-createdomain.html
 *
 * Synopsis
 * ```sql
 * CREATE DOMAIN name [ AS ] data_type
 * [ COLLATE collation ]
 * [ DEFAULT expression ]
 * [ domain_constraint [ ... ] ]
 *
 * where domain_constraint is:
 *
 * [ CONSTRAINT constraint_name ]
 * { NOT NULL | NULL | CHECK (expression) }
 * ```
 */
export class CreateDomain extends CreateDomainChange {
  public readonly domain: Domain;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get creates() {
    return [this.domain.stableId];
  }

  get requires() {
    const dependencies = new Set<string>();

    // Schema dependency
    dependencies.add(stableId.schema(this.domain.schema));

    // Owner dependency
    dependencies.add(stableId.role(this.domain.owner));

    // Base type dependency (if user-defined)
    if (
      this.domain.base_type_schema &&
      isUserDefinedTypeSchema(this.domain.base_type_schema)
    ) {
      dependencies.add(
        stableId.type(this.domain.base_type_schema, this.domain.base_type),
      );
    }

    // Collation dependency (if non-default and user-defined)
    if (this.domain.collation) {
      const unquotedCollation = this.domain.collation.replace(/^"|"$/g, "");
      const collationParts = unquotedCollation.split(".");
      if (collationParts.length === 2) {
        const [collationSchema, collationName] = collationParts;
        if (isUserDefinedTypeSchema(collationSchema)) {
          dependencies.add(stableId.collation(collationSchema, collationName));
        }
      }
    }

    return Array.from(dependencies);
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const lines: string[] = [];

    const domainName = `${this.domain.schema}.${this.domain.name}`;

    let baseType = this.domain.base_type_str as string;
    if (
      this.domain.base_type_schema &&
      this.domain.base_type_schema !== "pg_catalog"
    ) {
      baseType = `${this.domain.base_type_schema}.${baseType}`;
    }

    if (this.domain.array_dimensions && this.domain.array_dimensions > 0) {
      baseType += "[]".repeat(this.domain.array_dimensions);
    }

    lines.push(
      ctx.line(
        ctx.keyword("CREATE"),
        ctx.keyword("DOMAIN"),
        domainName,
        ctx.keyword("AS"),
        baseType,
      ),
    );

    if (this.domain.collation) {
      lines.push(ctx.line(ctx.keyword("COLLATE"), this.domain.collation));
    }

    if (this.domain.default_value) {
      lines.push(ctx.line(ctx.keyword("DEFAULT"), this.domain.default_value));
    }

    if (this.domain.not_null) {
      lines.push(ctx.line(ctx.keyword("NOT"), ctx.keyword("NULL")));
    }

    if (this.domain.constraints && this.domain.constraints.length > 0) {
      for (const c of this.domain.constraints) {
        if (c.check_expression && c.validated !== false) {
          lines.push(ctx.line(ctx.keyword("CHECK"), `(${c.check_expression})`));
        }
      }
    }

    return ctx.joinLines(lines);
  }
}
