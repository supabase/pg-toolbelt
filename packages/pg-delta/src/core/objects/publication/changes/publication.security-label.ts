import { quoteLiteral } from "../../base.change.ts";
import type { SecurityLabelProps } from "../../security-label.types.ts";
import { stableId } from "../../utils.ts";
import type { Publication } from "../publication.model.ts";
import {
  CreatePublicationChange,
  DropPublicationChange,
} from "./publication.base.ts";

export type SecurityLabelPublication =
  | CreateSecurityLabelOnPublication
  | DropSecurityLabelOnPublication;

export class CreateSecurityLabelOnPublication extends CreatePublicationChange {
  public readonly publication: Publication;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    publication: Publication;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.publication = props.publication;
    this.securityLabel = props.securityLabel;
  }

  get creates() {
    return [
      stableId.securityLabel(
        this.publication.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [this.publication.stableId];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON PUBLICATION",
      this.publication.name,
      "IS",
      quoteLiteral(this.securityLabel.label),
    ].join(" ");
  }
}

export class DropSecurityLabelOnPublication extends DropPublicationChange {
  public readonly publication: Publication;
  public readonly securityLabel: SecurityLabelProps;
  public readonly scope = "security_label" as const;

  constructor(props: {
    publication: Publication;
    securityLabel: SecurityLabelProps;
  }) {
    super();
    this.publication = props.publication;
    this.securityLabel = props.securityLabel;
  }

  get drops() {
    return [
      stableId.securityLabel(
        this.publication.stableId,
        this.securityLabel.provider,
      ),
    ];
  }

  get requires() {
    return [
      stableId.securityLabel(
        this.publication.stableId,
        this.securityLabel.provider,
      ),
      this.publication.stableId,
    ];
  }

  serialize(): string {
    return [
      "SECURITY LABEL FOR",
      this.securityLabel.provider,
      "ON PUBLICATION",
      this.publication.name,
      "IS NULL",
    ].join(" ");
  }
}
