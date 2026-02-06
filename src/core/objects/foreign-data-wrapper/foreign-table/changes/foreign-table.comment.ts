import { quoteLiteral } from "../../../base.change.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignTable } from "../foreign-table.model.ts";
import {
  CreateForeignTableChange,
  DropForeignTableChange,
} from "./foreign-table.base.ts";

/**
 * Create/drop comments on foreign tables.
 */

export type CommentForeignTable =
  | CreateCommentOnForeignTable
  | DropCommentOnForeignTable;

export class CreateCommentOnForeignTable extends CreateForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly scope = "comment" as const;

  constructor(props: { foreignTable: ForeignTable }) {
    super();
    this.foreignTable = props.foreignTable;
  }

  get creates() {
    return [stableId.comment(this.foreignTable.stableId)];
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: comment is not nullable in this case
      quoteLiteral(this.foreignTable.comment!),
    );
  }
}

export class DropCommentOnForeignTable extends DropForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly scope = "comment" as const;

  constructor(props: { foreignTable: ForeignTable }) {
    super();
    this.foreignTable = props.foreignTable;
  }

  get drops() {
    return [stableId.comment(this.foreignTable.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.foreignTable.stableId),
      this.foreignTable.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT"),
      ctx.keyword("ON"),
      ctx.keyword("FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}
