import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Schema } from "../schema.model.ts";
import { CreateSchemaChange, DropSchemaChange } from "./schema.base.ts";

export type SecurityLabelSchema =
  | CreateSecurityLabelOnSchema
  | DropSecurityLabelOnSchema;

export class CreateSecurityLabelOnSchema extends CreateSchemaChange {
  public readonly schema: Schema;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { schema: Schema; securityLabel: SecurityLabelProps }) {
    super();
    this.schema = props.schema;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(this.schema.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [this.schema.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON SCHEMA",
      this.schema.name,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnSchema extends DropSchemaChange {
  public readonly schema: Schema;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { schema: Schema; securityLabel: SecurityLabelProps }) {
    super();
    this.schema = props.schema;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(this.schema.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(this.schema.stableId, this.securityLabel.provider),
      this.schema.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON SCHEMA",
      this.schema.name,
      "IS NULL",
    ].join(" ");
  }
}
