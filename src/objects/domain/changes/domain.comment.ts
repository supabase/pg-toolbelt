import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

/**
 * Create/drop comments on domains.
 */
export class CreateCommentOnDomain extends CreateChange {
  public readonly domain: Domain;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get dependencies() {
    return [`comment:${this.domain.schema}.${this.domain.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON DOMAIN",
      `${this.domain.schema}.${this.domain.name}`,
      "IS",
      // biome-ignore lint/style/noNonNullAssertion: domain comment is not nullable in this case
      quoteLiteral(this.domain.comment!),
    ].join(" ");
  }
}

export class DropCommentOnDomain extends DropChange {
  public readonly domain: Domain;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  get dependencies() {
    return [`comment:${this.domain.schema}.${this.domain.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON DOMAIN",
      `${this.domain.schema}.${this.domain.name}`,
      "IS NULL",
    ].join(" ");
  }
}
