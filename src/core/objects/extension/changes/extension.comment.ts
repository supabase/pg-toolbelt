import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import { stableId } from "../../utils.ts";
import type { Extension } from "../extension.model.ts";
import {
  CreateExtensionChange,
  DropExtensionChange,
} from "./extension.base.ts";

export type CommentExtension =
  | CreateCommentOnExtension
  | DropCommentOnExtension;

/**
 * Create/drop comments on extensions.
 */
export class CreateCommentOnExtension extends CreateExtensionChange {
  public readonly extension: Extension;
  public readonly scope = "comment" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get creates() {
    return [stableId.comment(this.extension.stableId)];
  }

  get requires() {
    return [this.extension.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON EXTENSION"),
      this.extension.name,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: extension comment is not nullable here
      quoteLiteral(this.extension.comment!),
    );
  }
}

export class DropCommentOnExtension extends DropExtensionChange {
  public readonly extension: Extension;
  public readonly scope = "comment" as const;

  constructor(props: { extension: Extension }) {
    super();
    this.extension = props.extension;
  }

  get drops() {
    return [stableId.comment(this.extension.stableId)];
  }

  get requires() {
    return [stableId.comment(this.extension.stableId), this.extension.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON EXTENSION"),
      this.extension.name,
      ctx.keyword("IS NULL"),
    );
  }
}
