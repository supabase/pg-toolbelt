import { quoteLiteral } from "../../../base.change.ts";
import type { SecurityLabelProps } from "../../../security-label.types.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignTable } from "../foreign-table.model.ts";
import {
  CreateForeignTableChange,
  DropForeignTableChange,
} from "./foreign-table.base.ts";

export type SecurityLabelForeignTable =
  | CreateSecurityLabelOnForeignTable
  | DropSecurityLabelOnForeignTable;

export class CreateSecurityLabelOnForeignTable extends CreateForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    foreignTable: ForeignTable;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.foreignTable = props.foreignTable;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.foreignTable.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON FOREIGN TABLE",
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnForeignTable extends DropForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    foreignTable: ForeignTable;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.foreignTable = props.foreignTable;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.foreignTable.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.foreignTable.stableId,
        this.securityLabel.provider,
      ),
      this.foreignTable.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON FOREIGN TABLE",
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      "IS NULL",
    ].join(" ");
  }
}
