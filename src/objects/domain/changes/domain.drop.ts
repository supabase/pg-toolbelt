import { Change, quoteIdentifier } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

export class DropDomain extends Change {
  public readonly domain: Domain;

  constructor(props: { domain: Domain }) {
    super();
    this.domain = props.domain;
  }

  serialize(): string {
    return `DROP DOMAIN ${quoteIdentifier(this.domain.schema)}.${quoteIdentifier(this.domain.name)}`;
  }
}
