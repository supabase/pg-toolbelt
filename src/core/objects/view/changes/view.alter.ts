import { createFormatContext } from "../../../format/index.ts";
import type { SerializeOptions } from "../../../integrations/serialize/serialize.types.ts";
import type { View } from "../view.model.ts";
import { AlterViewChange } from "./view.base.ts";

/**
 * Alter a view.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterview.html
 *
 * Synopsis
 * ```sql
 * ALTER VIEW [ IF EXISTS ] name ALTER [ COLUMN ] column_name SET DEFAULT expression
 * ALTER VIEW [ IF EXISTS ] name ALTER [ COLUMN ] column_name DROP DEFAULT
 * ALTER VIEW [ IF EXISTS ] name OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 * ALTER VIEW [ IF EXISTS ] name RENAME [ COLUMN ] column_name TO new_column_name
 * ALTER VIEW [ IF EXISTS ] name RENAME TO new_name
 * ALTER VIEW [ IF EXISTS ] name SET SCHEMA new_schema
 * ALTER VIEW [ IF EXISTS ] name SET ( view_option_name [= view_option_value] [, ... ] )
 * ALTER VIEW [ IF EXISTS ] name RESET ( view_option_name [, ... ] )
 * ```
 */

export type AlterView =
  | AlterViewChangeOwner
  | AlterViewResetOptions
  | AlterViewSetOptions;

/**
 * ALTER VIEW ... OWNER TO ...
 */
export class AlterViewChangeOwner extends AlterViewChange {
  public readonly view: View;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { view: View; owner: string }) {
    super();
    this.view = props.view;
    this.owner = props.owner;
  }

  get requires() {
    return [this.view.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER VIEW"),
      `${this.view.schema}.${this.view.name}`,
      ctx.keyword("OWNER TO"),
      this.owner,
    );
  }
}

// NOTE: ReplaceView removed. Non-alterable changes are emitted as CREATE OR REPLACE in view.diff.ts.

/**
 * ALTER VIEW ... SET ( ... )
 */
export class AlterViewSetOptions extends AlterViewChange {
  public readonly view: View;
  public readonly options: string[];
  public readonly scope = "object" as const;

  constructor(props: { view: View; options: string[] }) {
    super();
    this.view = props.view;
    this.options = props.options;
  }

  get requires() {
    return [this.view.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const opts = this.options.join(", ");
    return ctx.line(
      ctx.keyword("ALTER VIEW"),
      `${this.view.schema}.${this.view.name}`,
      ctx.keyword("SET"),
      `(${opts})`,
    );
  }
}

/**
 * ALTER VIEW ... RESET ( ... )
 */
export class AlterViewResetOptions extends AlterViewChange {
  public readonly view: View;
  public readonly params: string[];
  public readonly scope = "object" as const;

  constructor(props: { view: View; params: string[] }) {
    super();
    this.view = props.view;
    this.params = props.params;
  }

  get requires() {
    return [this.view.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER VIEW"),
      `${this.view.schema}.${this.view.name}`,
      ctx.keyword("RESET"),
      `(${this.params.join(", ")})`,
    );
  }
}
