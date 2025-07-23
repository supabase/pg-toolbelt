import { Change, quoteIdentifier } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

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
export class AlterDomain extends Change {
  public readonly master: Domain;
  public readonly branch: Domain;

  constructor(props: { master: Domain; branch: Domain }) {
    super();
    this.master = props.master;
    this.branch = props.branch;
  }

  serialize(): string {
    return `ALTER DOMAIN ${quoteIdentifier(this.master.schema)}.${quoteIdentifier(this.master.name)} RENAME TO ${quoteIdentifier(this.branch.name)}`;
  }
}
