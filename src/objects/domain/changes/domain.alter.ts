import { Change, quoteIdentifier } from "../../base.change.ts";
import type { Domain } from "../domain.model.ts";

export class AlterDomain extends Change {
  public readonly master: Domain;
  public readonly branch: Domain;

  constructor(props: { master: Domain; branch: Domain }) {
    super();
    this.master = props.master;
    this.branch = props.branch;
  }

  serialize(): string {
    return `ALTER DOMAIN ${quoteIdentifier(this.master.schema)}.${quoteIdentifier(this.master.name)} RENAME TO ${quoteIdentifier(this.branch.name)}`;
  }
}
