import z from "zod";
import { deepEqual } from "./utils.ts";

export const columnPropsSchema = z.object({
  name: z.string(),
  position: z.number(),
  data_type: z.string(),
  data_type_str: z.string(),
  is_custom_type: z.boolean(),
  custom_type_type: z.string().nullable(),
  custom_type_category: z.string().nullable(),
  custom_type_schema: z.string().nullable(),
  custom_type_name: z.string().nullable(),
  not_null: z.boolean(),
  is_identity: z.boolean(),
  is_identity_always: z.boolean(),
  is_generated: z.boolean(),
  collation: z.string().nullable(),
  default: z.string().nullable(),
  comment: z.string().nullable(),
});

export type ColumnProps = z.infer<typeof columnPropsSchema>;

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
