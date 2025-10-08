import type { View } from "../view.model.ts";
import { DropViewChange } from "./view.base.ts";

/**
 * Drops a view from the database.
 *
 * @see https://www.postgresql.org/docs/17/sql-dropview.html
 */
export class DropView extends DropViewChange {
  public readonly view: View;
  public readonly scope = "object" as const;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get dependencies() {
    return [this.view.stableId];
  }

  serialize(): string {
    return ["DROP VIEW", `${this.view.schema}.${this.view.name}`].join(" ");
  }
}
