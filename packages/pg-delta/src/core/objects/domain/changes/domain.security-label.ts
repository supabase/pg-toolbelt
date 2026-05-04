import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Domain } from "../domain.model.ts";
import { CreateDomainChange, DropDomainChange } from "./domain.base.ts";

export type SecurityLabelDomain =
  | CreateSecurityLabelOnDomain
  | DropSecurityLabelOnDomain;

export class CreateSecurityLabelOnDomain extends CreateDomainChange {
  public readonly domain: Domain;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { domain: Domain; securityLabel: SecurityLabelProps }) {
    super();
    this.domain = props.domain;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(this.domain.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [this.domain.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON DOMAIN",
      `${this.domain.schema}.${this.domain.name}`,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnDomain extends DropDomainChange {
  public readonly domain: Domain;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: { domain: Domain; securityLabel: SecurityLabelProps }) {
    super();
    this.domain = props.domain;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(this.domain.stableId, this.securityLabel.provider),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(this.domain.stableId, this.securityLabel.provider),
      this.domain.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON DOMAIN",
      `${this.domain.schema}.${this.domain.name}`,
      "IS NULL",
    ].join(" ");
  }
}
