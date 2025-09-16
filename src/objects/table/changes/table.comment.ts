import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { ColumnProps } from "../../base.model.ts";
import type { Table, TableConstraintProps } from "../table.model.ts";

/**
 * Create a table/column/constraint comment.
 *
 * @see https://www.postgresql.org/docs/17/sql-comment.html
 *
 * Synopsis
 * ```sql
 * COMMENT ON
 * {
 *   COLUMN relation_name.column_name |
 *   CONSTRAINT constraint_name ON table_name |
 *   TABLE object_name
 * } IS { string_literal | NULL }
 *
 * ```
 */

/**
 * COMMENT ON TABLE ... IS ...
 */
export class CreateCommentOnTable extends CreateChange {
  public readonly table: Table;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get dependencies() {
    return [`comment:${this.table.schema}.${this.table.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TABLE",
      `${this.table.schema}.${this.table.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: table comment is not nullable in this case
      quoteLiteral(this.table.comment!),
    ].join(" ");
  }
}

/**
 * COMMENT ON TABLE ... IS ...
 */
export class DropCommentOnTable extends DropChange {
  public readonly table: Table;

  constructor(props: { table: Table }) {
    super();
    this.table = props.table;
  }

  get dependencies() {
    return [`comment:${this.table.schema}.${this.table.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON TABLE",
      `${this.table.schema}.${this.table.name}`,
      "IS NULL",
    ].join(" ");
  }
}

/**
 * COMMENT ON COLUMN ... IS ...
 */
export class CreateCommentOnColumn extends CreateChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get dependencies() {
    return [
      `comment:${this.table.schema}.${this.table.name}.${this.column.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.table.schema}.${this.table.name}.${this.column.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: column comment is not nullable in this case
      quoteLiteral(this.column.comment!),
    ].join(" ");
  }
}

/**
 * COMMENT ON COLUMN ... IS ...
 */
export class DropCommentOnColumn extends DropChange {
  public readonly table: Table;
  public readonly column: ColumnProps;

  constructor(props: { table: Table; column: ColumnProps }) {
    super();
    this.table = props.table;
    this.column = props.column;
  }

  get dependencies() {
    return [
      `comment:${this.table.schema}.${this.table.name}.${this.column.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON COLUMN",
      `${this.table.schema}.${this.table.name}.${this.column.name}`,
      "IS NULL",
    ].join(" ");
  }
}

/**
 * COMMENT ON CONSTRAINT ... IS ...
 */
export class CreateCommentOnConstraint extends CreateChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;

  constructor(props: {
    table: Table;
    constraint: TableConstraintProps;
  }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get dependencies() {
    return [
      `comment:${this.table.schema}.${this.table.name}.${this.constraint.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON CONSTRAINT",
      this.constraint.name,
      "ON",
      `${this.table.schema}.${this.table.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: constraint comment is not nullable in this case
      quoteLiteral(this.constraint.comment!),
    ].join(" ");
  }
}

/**
 * COMMENT ON CONSTRAINT ... IS ...
 */
export class DropCommentOnConstraint extends DropChange {
  public readonly table: Table;
  public readonly constraint: TableConstraintProps;

  constructor(props: {
    table: Table;
    constraint: TableConstraintProps;
  }) {
    super();
    this.table = props.table;
    this.constraint = props.constraint;
  }

  get dependencies() {
    return [
      `comment:${this.table.schema}.${this.table.name}.${this.constraint.name}`,
    ];
  }

  serialize(): string {
    return [
      "COMMENT ON CONSTRAINT",
      this.constraint.name,
      "ON",
      `${this.table.schema}.${this.table.name}`,
      "IS NULL",
    ].join(" ");
  }
}
