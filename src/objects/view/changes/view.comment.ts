import { CreateChange, DropChange, quoteLiteral } from "../../base.change.ts";
import type { View } from "../view.model.ts";

export class CreateCommentOnView extends CreateChange {
  public readonly view: View;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get dependencies() {
    return [`comment:${this.view.schema}.${this.view.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON VIEW",
      `${this.view.schema}.${this.view.name}`,
      "IS",
      quoteLiteral(this.view.comment as string),
    ].join(" ");
  }
}

export class DropCommentOnView extends DropChange {
  public readonly view: View;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get dependencies() {
    return [`comment:${this.view.schema}.${this.view.name}`];
  }

  serialize(): string {
    return [
      "COMMENT ON VIEW",
      `${this.view.schema}.${this.view.name}`,
      "IS NULL",
    ].join(" ");
  }
}
