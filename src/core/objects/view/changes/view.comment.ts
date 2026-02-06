import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { View } from "../view.model.ts";
import { CreateViewChange, DropViewChange } from "./view.base.ts";

export type CommentView = CreateCommentOnView | DropCommentOnView;

export class CreateCommentOnView extends CreateViewChange {
  public readonly view: View;
  public readonly scope = "comment" as const;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get creates() {
    return [stableId.comment(this.view.stableId)];
  }

  get requires() {
    return [this.view.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON VIEW"),
      `${this.view.schema}.${this.view.name}`,
      ctx.keyword("IS"),
      quoteLiteral(this.view.comment as string),
    );
  }
}

export class DropCommentOnView extends DropViewChange {
  public readonly view: View;
  public readonly scope = "comment" as const;

  constructor(props: { view: View }) {
    super();
    this.view = props.view;
  }

  get drops() {
    return [stableId.comment(this.view.stableId)];
  }

  get requires() {
    return [stableId.comment(this.view.stableId), this.view.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON VIEW"),
      `${this.view.schema}.${this.view.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}
