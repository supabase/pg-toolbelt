import { SqlFormatter } from "../../../format/index.ts";
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
    if (options?.format?.enabled) {
      const formatter = new SqlFormatter(options.format);
      return this.serializeFormatted(formatter);
    }

    const parts: string[] = [];

    // Schema-qualified name
    const domainName = `${this.domain.schema}.${this.domain.name}`;

    // Base type (use formatted string for type+typmod and add schema if needed)
    let baseType = this.domain.base_type_str as string;
    if (
      this.domain.base_type_schema &&
      this.domain.base_type_schema !== "pg_catalog"
    ) {
      baseType = `${this.domain.base_type_schema}.${baseType}`;
    }

    // Array dimensions
    if (this.domain.array_dimensions && this.domain.array_dimensions > 0) {
      baseType += "[]".repeat(this.domain.array_dimensions);
    }

    parts.push(`CREATE DOMAIN ${domainName} AS ${baseType}`);

    // Collation
    if (this.domain.collation) {
      parts.push(`COLLATE ${this.domain.collation}`);
    }

    // Default value
    if (this.domain.default_value) {
      parts.push(`DEFAULT ${this.domain.default_value}`);
    }

    // NOT NULL constraint
    if (this.domain.not_null) {
      parts.push("NOT NULL");
    }

    // Inline CHECK constraints that are already validated
    if (this.domain.constraints && this.domain.constraints.length > 0) {
      for (const c of this.domain.constraints) {
        if (c.check_expression && c.validated !== false) {
          parts.push(`CHECK (${c.check_expression})`);
        }
      }
    }

    return parts.join(" ");
  }

  private serializeFormatted(formatter: SqlFormatter): string {
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
      `${formatter.keyword("CREATE")} ${formatter.keyword("DOMAIN")} ${domainName} ${formatter.keyword("AS")} ${baseType}`,
    );

    if (this.domain.collation) {
      lines.push(
        `${formatter.keyword("COLLATE")} ${this.domain.collation}`,
      );
    }

    if (this.domain.default_value) {
      lines.push(
        `${formatter.keyword("DEFAULT")} ${this.domain.default_value}`,
      );
    }

    if (this.domain.not_null) {
      lines.push(
        `${formatter.keyword("NOT")} ${formatter.keyword("NULL")}`,
      );
    }

    if (this.domain.constraints && this.domain.constraints.length > 0) {
      for (const c of this.domain.constraints) {
        if (c.check_expression && c.validated !== false) {
          lines.push(
            `${formatter.keyword("CHECK")} (${c.check_expression})`,
          );
        }
      }
    }

    return lines.join("\n");
  }
}
