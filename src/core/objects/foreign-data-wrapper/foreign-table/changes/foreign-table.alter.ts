import { quoteLiteral } from "../../../base.change.ts";
import type { ColumnProps } from "../../../base.model.ts";
import { createFormatContext } from "../../../../format/index.ts";
import type { SerializeOptions } from "../../../../integrations/serialize/serialize.types.ts";
import { stableId } from "../../../utils.ts";
import type { ForeignTable } from "../foreign-table.model.ts";
import { AlterForeignTableChange } from "./foreign-table.base.ts";

/**
 * Alter a foreign table.
 *
 * @see https://www.postgresql.org/docs/17/sql-alterforeigntable.html
 *
 * Synopsis
 * ```sql
 * ALTER FOREIGN TABLE [ IF EXISTS ] [ ONLY ] name [ * ]
 *     action [, ... ]
 * where action is one of:
 *     ADD [ COLUMN ] [ IF NOT EXISTS ] column_name data_type [ OPTIONS ( option 'value' [, ... ] ) ] [ COLLATE collation ] [ column_constraint [ ... ] ]
 *     DROP [ COLUMN ] [ IF EXISTS ] column_name [ RESTRICT | CASCADE ]
 *     ALTER [ COLUMN ] column_name [ SET DATA ] TYPE data_type [ COLLATE collation ]
 *     ALTER [ COLUMN ] column_name SET DEFAULT expression
 *     ALTER [ COLUMN ] column_name DROP DEFAULT
 *     ALTER [ COLUMN ] column_name { SET | DROP } NOT NULL
 *     ALTER [ COLUMN ] column_name OPTIONS ( [ ADD | SET | DROP ] option ['value'] [, ... ] )
 *     OWNER TO { new_owner | CURRENT_ROLE | CURRENT_USER | SESSION_USER }
 *     OPTIONS ( [ ADD | SET | DROP ] option ['value'] [, ... ] )
 * ```
 */

export type AlterForeignTable =
  | AlterForeignTableChangeOwner
  | AlterForeignTableAddColumn
  | AlterForeignTableDropColumn
  | AlterForeignTableAlterColumnType
  | AlterForeignTableAlterColumnSetDefault
  | AlterForeignTableAlterColumnDropDefault
  | AlterForeignTableAlterColumnSetNotNull
  | AlterForeignTableAlterColumnDropNotNull
  | AlterForeignTableSetOptions;

/**
 * ALTER FOREIGN TABLE ... OWNER TO ...
 */
export class AlterForeignTableChangeOwner extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly owner: string;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable; owner: string }) {
    super();
    this.foreignTable = props.foreignTable;
    this.owner = props.owner;
  }

  get requires() {
    return [this.foreignTable.stableId, stableId.role(this.owner)];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("OWNER TO"),
      this.owner,
    );
  }
}

/**
 * ALTER FOREIGN TABLE ... ADD COLUMN ...
 */
export class AlterForeignTableAddColumn extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly column: ColumnProps;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable; column: ColumnProps }) {
    super();
    this.foreignTable = props.foreignTable;
    this.column = props.column;
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const parts = [
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("ADD COLUMN"),
      this.column.name,
      this.column.data_type_str,
    ];

    if (this.column.not_null) {
      parts.push(ctx.keyword("NOT NULL"));
    }

    if (this.column.default) {
      parts.push(ctx.keyword("DEFAULT"), this.column.default);
    }

    return ctx.line(...parts);
  }
}

/**
 * ALTER FOREIGN TABLE ... DROP COLUMN ...
 */
export class AlterForeignTableDropColumn extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly columnName: string;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable; columnName: string }) {
    super();
    this.foreignTable = props.foreignTable;
    this.columnName = props.columnName;
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("DROP COLUMN"),
      this.columnName,
    );
  }
}

/**
 * ALTER FOREIGN TABLE ... ALTER COLUMN ... TYPE ...
 */
export class AlterForeignTableAlterColumnType extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly columnName: string;
  public readonly dataType: string;
  public readonly scope = "object" as const;

  constructor(props: {
    foreignTable: ForeignTable;
    columnName: string;
    dataType: string;
  }) {
    super();
    this.foreignTable = props.foreignTable;
    this.columnName = props.columnName;
    this.dataType = props.dataType;
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("ALTER COLUMN"),
      this.columnName,
      ctx.keyword("TYPE"),
      this.dataType,
    );
  }
}

/**
 * ALTER FOREIGN TABLE ... ALTER COLUMN ... SET DEFAULT ...
 */
export class AlterForeignTableAlterColumnSetDefault extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly columnName: string;
  public readonly defaultValue: string;
  public readonly scope = "object" as const;

  constructor(props: {
    foreignTable: ForeignTable;
    columnName: string;
    defaultValue: string;
  }) {
    super();
    this.foreignTable = props.foreignTable;
    this.columnName = props.columnName;
    this.defaultValue = props.defaultValue;
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("ALTER COLUMN"),
      this.columnName,
      ctx.keyword("SET DEFAULT"),
      this.defaultValue,
    );
  }
}

/**
 * ALTER FOREIGN TABLE ... ALTER COLUMN ... DROP DEFAULT
 */
export class AlterForeignTableAlterColumnDropDefault extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly columnName: string;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable; columnName: string }) {
    super();
    this.foreignTable = props.foreignTable;
    this.columnName = props.columnName;
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("ALTER COLUMN"),
      this.columnName,
      ctx.keyword("DROP DEFAULT"),
    );
  }
}

/**
 * ALTER FOREIGN TABLE ... ALTER COLUMN ... SET NOT NULL
 */
export class AlterForeignTableAlterColumnSetNotNull extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly columnName: string;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable; columnName: string }) {
    super();
    this.foreignTable = props.foreignTable;
    this.columnName = props.columnName;
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("ALTER COLUMN"),
      this.columnName,
      ctx.keyword("SET NOT NULL"),
    );
  }
}

/**
 * ALTER FOREIGN TABLE ... ALTER COLUMN ... DROP NOT NULL
 */
export class AlterForeignTableAlterColumnDropNotNull extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly columnName: string;
  public readonly scope = "object" as const;

  constructor(props: { foreignTable: ForeignTable; columnName: string }) {
    super();
    this.foreignTable = props.foreignTable;
    this.columnName = props.columnName;
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    return ctx.line(
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("ALTER COLUMN"),
      this.columnName,
      ctx.keyword("DROP NOT NULL"),
    );
  }
}

/**
 * ALTER FOREIGN TABLE ... OPTIONS ( ADD | SET | DROP ... )
 */
export class AlterForeignTableSetOptions extends AlterForeignTableChange {
  public readonly foreignTable: ForeignTable;
  public readonly options: Array<{
    action: "ADD" | "SET" | "DROP";
    option: string;
    value?: string;
  }>;
  public readonly scope = "object" as const;

  constructor(props: {
    foreignTable: ForeignTable;
    options: Array<{
      action: "ADD" | "SET" | "DROP";
      option: string;
      value?: string;
    }>;
  }) {
    super();
    this.foreignTable = props.foreignTable;
    this.options = props.options;
  }

  get requires() {
    return [this.foreignTable.stableId];
  }

  serialize(options?: SerializeOptions): string {
    const ctx = createFormatContext(options?.format);
    const optionParts: string[] = [];
    for (const opt of this.options) {
      if (opt.action === "DROP") {
        optionParts.push(`${ctx.keyword("DROP")} ${opt.option}`);
      } else {
        const value = opt.value !== undefined ? quoteLiteral(opt.value) : "''";
        optionParts.push(`${ctx.keyword(opt.action)} ${opt.option} ${value}`);
      }
    }

    return ctx.line(
      ctx.keyword("ALTER FOREIGN TABLE"),
      `${this.foreignTable.schema}.${this.foreignTable.name}`,
      ctx.keyword("OPTIONS"),
      `(${optionParts.join(", ")})`,
    );
  }
}
