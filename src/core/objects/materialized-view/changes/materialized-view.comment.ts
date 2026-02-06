import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import { quoteLiteral } from "../../base.change.ts";
import type { ColumnProps } from "../../base.model.ts";
import { stableId } from "../../utils.ts";
import type { MaterializedView } from "../materialized-view.model.ts";
import {
  CreateMaterializedViewChange,
  DropMaterializedViewChange,
} from "./materialized-view.base.ts";

export type CommentMaterializedView =
  | CreateCommentOnMaterializedView
  | CreateCommentOnMaterializedViewColumn
  | DropCommentOnMaterializedView
  | DropCommentOnMaterializedViewColumn;

/**
 * Create/drop comments on materialized view columns.
 *
 * @see https://www.postgresql.org/docs/17/sql-comment.html
 */

export class CreateCommentOnMaterializedView extends CreateMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly scope = "comment" as const;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  get creates() {
    return [stableId.comment(this.materializedView.stableId)];
  }

  get requires() {
    return [this.materializedView.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON MATERIALIZED VIEW"),
      `${this.materializedView.schema}.${this.materializedView.name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: mv comment is not nullable in this case
      quoteLiteral(this.materializedView.comment!),
    );
  }
}

export class DropCommentOnMaterializedView extends DropMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly scope = "comment" as const;

  constructor(props: { materializedView: MaterializedView }) {
    super();
    this.materializedView = props.materializedView;
  }

  get drops() {
    return [stableId.comment(this.materializedView.stableId)];
  }

  get requires() {
    return [
      stableId.comment(this.materializedView.stableId),
      this.materializedView.stableId,
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON MATERIALIZED VIEW"),
      `${this.materializedView.schema}.${this.materializedView.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}

export class CreateCommentOnMaterializedViewColumn extends CreateMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly column: ColumnProps;
  public readonly scope = "comment" as const;

  constructor(props: {
    materializedView: MaterializedView;
    column: ColumnProps;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.column = props.column;
  }

  get creates() {
    return [
      stableId.comment(
        stableId.column(
          this.materializedView.schema,
          this.materializedView.name,
          this.column.name,
        ),
      ),
    ];
  }

  get requires() {
    return [
      stableId.column(
        this.materializedView.schema,
        this.materializedView.name,
        this.column.name,
      ),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON COLUMN"),
      `${this.materializedView.schema}.${this.materializedView.name}.${this.column.name}`,
      ctx.keyword("IS"),
      // biome-ignore lint/style/noNonNullAssertion: column comment is not nullable in this case
      quoteLiteral(this.column.comment!),
    );
  }
}

export class DropCommentOnMaterializedViewColumn extends DropMaterializedViewChange {
  public readonly materializedView: MaterializedView;
  public readonly column: ColumnProps;
  public readonly scope = "comment" as const;

  constructor(props: {
    materializedView: MaterializedView;
    column: ColumnProps;
  }) {
    super();
    this.materializedView = props.materializedView;
    this.column = props.column;
  }

  get drops() {
    return [
      stableId.comment(
        stableId.column(
          this.materializedView.schema,
          this.materializedView.name,
          this.column.name,
        ),
      ),
    ];
  }

  get requires() {
    return [
      stableId.comment(
        stableId.column(
          this.materializedView.schema,
          this.materializedView.name,
          this.column.name,
        ),
      ),
      stableId.column(
        this.materializedView.schema,
        this.materializedView.name,
        this.column.name,
      ),
    ];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("COMMENT ON COLUMN"),
      `${this.materializedView.schema}.${this.materializedView.name}.${this.column.name}`,
      ctx.keyword("IS NULL"),
    );
  }
}
