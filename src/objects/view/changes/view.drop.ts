import { DropChange, quoteIdentifier } from "../../base.change.ts";
import type { View } from "../view.model.ts";

/**
 * Drops a view from the database.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropview.html
 */
export class DropView extends DropChange {
  public readonly stableId: string;
  public readonly view: View;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
    this.stableId = `${this.view.stableId}`;
  }

  serialize(): string {
    return [
      "DROP VIEW",
      `${quoteIdentifier(this.view.schema)}.${quoteIdentifier(this.view.name)}`,
    ].join(" ");
  }
}
