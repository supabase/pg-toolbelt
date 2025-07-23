import { Change, quoteIdentifier } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

export class CreateDomain extends Change {
  public readonly domain: Domain;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  serialize(): string {
    const parts: string[] = [];

    // Schema-qualified name
    const domainName = `${quoteIdentifier(this.domain.schema)}.${quoteIdentifier(this.domain.name)}`;

    // Base type with schema
    let baseType =
      this.domain.base_type_schema &&
      this.domain.base_type_schema !== "pg_catalog"
        ? `${quoteIdentifier(this.domain.base_type_schema)}.${quoteIdentifier(this.domain.base_type)}`
        : quoteIdentifier(this.domain.base_type);

    // Array dimensions
    if (this.domain.array_dimensions && this.domain.array_dimensions > 0) {
      baseType += "[]".repeat(this.domain.array_dimensions);
    }

    parts.push(`CREATE DOMAIN ${domainName} AS ${baseType}`);

    // Collation
    if (this.domain.collation) {
      parts.push(`COLLATE ${quoteIdentifier(this.domain.collation)}`);
    }

    // Default value
    if (this.domain.default_value) {
      parts.push(`DEFAULT ${this.domain.default_value}`);
    }

    // NOT NULL constraint
    if (this.domain.not_null) {
      parts.push("NOT NULL");
    }

    return parts.join(" ");
  }
}
