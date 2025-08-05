import {
  AlterChange,
  quoteIdentifier,
  ReplaceChange,
} from "../../base.change.ts";
import type { Constraint } from "../constraint.model.ts";
import { CreateConstraint } from "./constraint.create.ts";
import { DropConstraint } from "./constraint.drop.ts";

/**
 * Alter a constraint.
 *
 * @see https://www.postgresql.org/docs/17/sql-altertable.html
 *
 * Synopsis
 * ```sql
 * ALTER TABLE table_name RENAME CONSTRAINT constraint_name TO new_constraint_name
 * ALTER TABLE table_name ALTER CONSTRAINT constraint_name [ DEFERRABLE | NOT DEFERRABLE ] [ INITIALLY DEFERRED | INITIALLY IMMEDIATE ]
 * ```
 */
export type AlterConstraint = never; // No alterable properties for constraints

/**
 * Replace a constraint by dropping and recreating it.
 * This is used when properties that cannot be altered via ALTER TABLE change.
 */
export class ReplaceConstraint extends ReplaceChange {
  public readonly main: Constraint;
  public readonly branch: Constraint;

  constructor(props: { main: Constraint; branch: Constraint }) {
    super();
    this.main = props.main;
    this.branch = props.branch;
  }

  serialize(): string {
    const dropChange = new DropConstraint({ constraint: this.main });
    const createChange = new CreateConstraint({ constraint: this.branch });

    return [dropChange.serialize(), createChange.serialize()].join(";\n");
  }
}
