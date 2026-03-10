import { Schema } from "effect";
import { deepEqual } from "./utils.ts";

export const columnPropsSchema = Schema.Struct({
  name: Schema.String,
  position: Schema.Number,
  data_type: Schema.String,
  data_type_str: Schema.String,
  is_custom_type: Schema.Boolean,
  custom_type_type: Schema.NullOr(Schema.String),
  custom_type_category: Schema.NullOr(Schema.String),
  custom_type_schema: Schema.NullOr(Schema.String),
  custom_type_name: Schema.NullOr(Schema.String),
  not_null: Schema.Boolean,
  is_identity: Schema.Boolean,
  is_identity_always: Schema.Boolean,
  is_generated: Schema.Boolean,
  collation: Schema.NullOr(Schema.String),
  default: Schema.NullOr(Schema.String),
  comment: Schema.NullOr(Schema.String),
});

export type ColumnProps = typeof columnPropsSchema.Type;

export function normalizeColumns(columns: ColumnProps[]) {
  return columns
    .map((column) => {
      const { position: _position, ...rest } = column;
      return rest;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Interface for table-like objects that have columns (tables, views, materialized views).
 * In PostgreSQL, these are relations with relkind in ('r', 'p', 'v', 'm').
 */
export interface TableLikeObject {
  readonly columns: ColumnProps[];
}

export abstract class BasePgModel {
  /**
   * Database-portable stable identifier for dependency resolution.
   * This identifier remains constant across database dumps/restores and
   * is used for cross-database dependency resolution.
   */
  abstract get stableId(): string;

  /**
   * Get all identity fields and their values.
   * Subclasses should override this to return the identity fields.
   */
  abstract get identityFields(): Record<string, unknown>;

  /**
   * Get all data fields and their values.
   * Subclasses should override this to return the data fields.
   */
  abstract get dataFields(): Record<string, unknown>;

  /**
   * Compare this object with another BasePgModel for equality based on stableId and dataFields.
   */
  equals(other: BasePgModel): boolean {
    return (
      this.stableId === other.stableId &&
      deepEqual(this.dataFields, other.dataFields)
    );
  }

  /**
   * Stable representation used for equality/fingerprints.
   * Subclasses can override to normalize unstable fields.
   */
  stableSnapshot() {
    return {
      identity: this.identityFields,
      data: this.dataFields,
    };
  }
}
