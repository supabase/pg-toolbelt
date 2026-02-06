import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../utils.ts";
import type { Domain, DomainConstraintProps } from "../domain.model.ts";
import { AlterDomainChange, DropDomainChange } from "./domain.base.ts";

/**
 * Alter a domain.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterdomain.html
 *
 * Synopsis
 * ```sql
 * ALTER DOMAIN name
 *     { SET DEFAULT expression | DROP DEFAULT }
 * ALTER DOMAIN name
 *     { SET | DROP } NOT NULL
 * ALTER DOMAIN name
 *     ADD domain_constraint [ NOT VALID ]
 * ALTER DOMAIN name
 *     DROP CONSTRAINT [ IF EXISTS ] constraint_name [ RESTRICT | CASCADE ]
 * ALTER DOMAIN name
 *     RENAME CONSTRAINT constraint_name TO new_constraint_name
 * ALTER DOMAIN name
 *     VALIDATE CONSTRAINT constraint_name
 * ALTER DOMAIN name
 *     OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER DOMAIN name
 *     RENAME TO new_name
 * ALTER DOMAIN name
 *     SET SCHEMA new_schema
 *
 * where domain_constraint is:
 *
 *     [ CONSTRAINT constraint_name ]
 *     { NOT NULL | CHECK (expression) }
 * ```
 */

export type AlterDomain =
  | AlterDomainAddConstraint
  | AlterDomainChangeOwner
  | AlterDomainDropConstraint
  | AlterDomainDropDefault
  | AlterDomainDropNotNull
  | AlterDomainSetDefault
  | AlterDomainSetNotNull
  | AlterDomainValidateConstraint;

/**
 * ALTER DOMAIN ... SET DEFAULT ...
 */
export class AlterDomainSetDefault extends AlterDomainChange {
  public readonly domain: Domain;
  public readonly defaultValue: string;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain; defaultValue: string }) {
    super();
    this.domain = props.domain;
    this.defaultValue = props.defaultValue;
  }

  get requires() {
    return [this.domain.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER DOMAIN"),
      `${this.domain.schema}.${this.domain.name}`,
      ctx.keyword("SET DEFAULT"),
      this.defaultValue,
    );
  }
}

/**
 * ALTER DOMAIN ... DROP DEFAULT
 */
export class AlterDomainDropDefault extends AlterDomainChange {
  public readonly domain: Domain;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get requires() {
    return [this.domain.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER DOMAIN"),
      `${this.domain.schema}.${this.domain.name}`,
      ctx.keyword("DROP DEFAULT"),
    );
  }
}

/**
 * ALTER DOMAIN ... SET NOT NULL
 */
export class AlterDomainSetNotNull extends AlterDomainChange {
  public readonly domain: Domain;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get requires() {
    return [this.domain.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER DOMAIN"),
      `${this.domain.schema}.${this.domain.name}`,
      ctx.keyword("SET NOT NULL"),
    );
  }
}

/**
 * ALTER DOMAIN ... DROP NOT NULL
 */
export class AlterDomainDropNotNull extends AlterDomainChange {
  public readonly domain: Domain;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get requires() {
    return [this.domain.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER DOMAIN"),
      `${this.domain.schema}.${this.domain.name}`,
      ctx.keyword("DROP NOT NULL"),
    );
  }
}

/**
 * ALTER DOMAIN ... OWNER TO ...
 */
export class AlterDomainChangeOwner extends AlterDomainChange {
  public readonly domain: Domain;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain; owner: string }) {
    super();
    this.domain = props.domain;
    this.owner = props.owner;
  }

  get requires() {
    return [this.domain.stableId, stableId.role(this.owner)];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER DOMAIN"),
      `${this.domain.schema}.${this.domain.name}`,
      ctx.keyword("OWNER TO"),
      this.owner,
    );
  }
}

/**
 * ALTER DOMAIN ... ADD CONSTRAINT ... [ NOT VALID ]
 */
export class AlterDomainAddConstraint extends AlterDomainChange {
  public readonly domain: Domain;
  public readonly constraint: DomainConstraintProps;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain; constraint: DomainConstraintProps }) {
    super();
    this.domain = props.domain;
    this.constraint = props.constraint;
  }

  get creates() {
    return [
      stableId.constraint(
        this.domain.schema,
        this.domain.name,
        this.constraint.name,
      ),
    ];
  }

  get requires() {
    return [this.domain.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const domainName = `${this.domain.schema}.${this.domain.name}`;
    const parts: string[] = [
      ctx.keyword("ALTER DOMAIN"),
      domainName,
      ctx.keyword("ADD CONSTRAINT"),
      this.constraint.name,
    ];
    if (this.constraint.check_expression) {
      parts.push(`CHECK (${this.constraint.check_expression})`);
    }
    if (!this.constraint.validated) {
      parts.push(ctx.keyword("NOT VALID"));
    }
    return ctx.line(...parts);
  }
}

/**
 * ALTER DOMAIN ... DROP CONSTRAINT ...
 */
export class AlterDomainDropConstraint extends DropDomainChange {
  public readonly domain: Domain;
  public readonly constraint: DomainConstraintProps;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain; constraint: DomainConstraintProps }) {
    super();
    this.domain = props.domain;
    this.constraint = props.constraint;
  }

  get requires() {
    return [
      this.domain.stableId,
      stableId.constraint(
        this.domain.schema,
        this.domain.name,
        this.constraint.name,
      ),
    ];
  }

  get drops() {
    return [
      stableId.constraint(
        this.domain.schema,
        this.domain.name,
        this.constraint.name,
      ),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const domainName = `${this.domain.schema}.${this.domain.name}`;
    return ctx.line(
      ctx.keyword("ALTER DOMAIN"),
      domainName,
      ctx.keyword("DROP CONSTRAINT"),
      this.constraint.name,
    );
  }
}

// Constraint renames are modeled as drop+add because the constraint name
// is part of the identity used in diffing and dependency resolution.

/**
 * ALTER DOMAIN ... VALIDATE CONSTRAINT ...
 */
export class AlterDomainValidateConstraint extends AlterDomainChange {
  public readonly domain: Domain;
  public readonly constraint: DomainConstraintProps;
  public readonly scope = "object" as const;

  constructor(props: { domain: Domain; constraint: DomainConstraintProps }) {
    super();
    this.domain = props.domain;
    this.constraint = props.constraint;
  }

  get requires() {
    return [
      this.domain.stableId,
      stableId.constraint(
        this.domain.schema,
        this.domain.name,
        this.constraint.name,
      ),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const domainName = `${this.domain.schema}.${this.domain.name}`;
    return ctx.line(
      ctx.keyword("ALTER DOMAIN"),
      domainName,
      ctx.keyword("VALIDATE CONSTRAINT"),
      this.constraint.name,
    );
  }
}
