import { quoteLiteral } from "../../base.change.ts";
import type { ColumnProps } from "../../base.model.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Table } from "../table.model.ts";
import { CreateTableChange, DropTableChange } from "./table.base.ts";

export type SecurityLabelTable =
  | CreateSecurityLabelOnTable
  | DropSecurityLabelOnTable
  | CreateSecurityLabelOnColumn
  | DropSecurityLabelOnColumn;

/**
 * SECURITY LABEL FOR <provider> ON TABLE <schema>.<table> IS <literal>
 */
export class CreateSecurityLabelOnTable extends CreateTableChange {
  public readonly table: Table;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { table: Table; securityLabel: SecurityLabelProps }) {
    super();
    this.table = props.table;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(this.table.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [this.table.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON TABLE",
      `${this.table.schema}.${this.table.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnTable extends DropTableChange {
  public readonly table: Table;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { table: Table; securityLabel: SecurityLabelProps }) {
    super();
    this.table = props.table;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(this.table.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(this.table.stableId, this.securityLabel.provider),
      this.table.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON TABLE",
      `${this.table.schema}.${this.table.name}`,
      "IS NULL",
    ].join(" ");
  }
}

/**
 * SECURITY LABEL FOR <provider> ON COLUMN <schema>.<table>.<column> IS <literal>
 */
export class CreateSecurityLabelOnColumn extends CreateTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    table: Table;
    column: ColumnProps;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.table = props.table;
    this.column = props.column;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    const columnStableId = stableId.column(
      this.table.schema,
      this.table.name,
      this.column.name,
    );
    return [stableId.securityLabel(columnStableId, this.securityLabel.provider)];
  }

  get requires() {
    return [
      stableId.column(this.table.schema, this.table.name, this.column.name),
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON COLUMN",
      `${this.table.schema}.${this.table.name}.${this.column.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnColumn extends DropTableChange {
  public readonly table: Table;
  public readonly column: ColumnProps;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    table: Table;
    column: ColumnProps;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.table = props.table;
    this.column = props.column;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    const columnStableId = stableId.column(
      this.table.schema,
      this.table.name,
      this.column.name,
    );
    return [stableId.securityLabel(columnStableId, this.securityLabel.provider)];
  }

  get requires() {
    const columnStableId = stableId.column(
      this.table.schema,
      this.table.name,
      this.column.name,
    );
    return [
      stableId.securityLabel(columnStableId, this.securityLabel.provider),
      columnStableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON COLUMN",
      `${this.table.schema}.${this.table.name}.${this.column.name}`,
      "IS NULL",
    ].join(" ");
  }
}
