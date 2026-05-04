import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { MaterializedView } from "../materialized-view.model.ts";
import {
  CreateMaterializedViewChange,
  DropMaterializedViewChange,
} from "./materialized-view.base.ts";

export type SecurityLabelMaterializedView =
  | CreateSecurityLabelOnMaterializedView
  | DropSecurityLabelOnMaterializedView;

export class CreateSecurityLabelOnMaterializedView extends CreateMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    materializedView: MaterializedView;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.materializedView.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.materializedView.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON MATERIALIZED VIEW",
      `${this.materializedView.schema}.${this.materializedView.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnMaterializedView extends DropMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    materializedView: MaterializedView;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.materializedView.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.materializedView.stableId,
        this.securityLabel.provider,
      ),
      this.materializedView.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON MATERIALIZED VIEW",
      `${this.materializedView.schema}.${this.materializedView.name}`,
      "IS NULL",
    ].join(" ");
  }
}
