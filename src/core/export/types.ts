/**
 * Type definitions for declarative schema export.
 */

// ============================================================================
// File Categories
// ============================================================================

export const CATEGORY_PRIORITY = {
  cluster: 0,
  schema: 1,
  extensions: 2,
  types: 3,
  sequences: 4,
  tables: 5,
  foreign_tables: 6,
  views: 7,
  matviews: 8,
  functions: 9,
  procedures: 10,
  aggregates: 11,
  domains: 12,
  collations: 13,
  publications: 14,
  subscriptions: 15,
  event_triggers: 16,
} as const;

export type FileCategory = keyof typeof CATEGORY_PRIORITY;

// ============================================================================
// Output Types
// ============================================================================

export interface FileMetadata {
  objectType: string;
  schemaName?: string;
  objectName?: string;
}

export interface FileEntry {
  path: string;
  order: number;
  statements: number;
  sql: string;
  metadata: FileMetadata;
}

export interface DeclarativeSchemaOutput {
  version: 1;
  mode: "declarative";
  generatedAt: string;
  source: { fingerprint: string };
  target: { fingerprint: string };
  files: FileEntry[];
}

// ============================================================================
// Entity Grouping
// ============================================================================

/** A regex pattern with a group name used as the directory or file name. */
export interface GroupingPattern {
  /** Regex to test against the object name. Strings are compiled to RegExp. */
  pattern: string | RegExp;
  /** Group name used as the directory or file name. */
  name: string;
}

export interface PrefixGrouping {
  /** How grouped entities are organized on disk. */
  mode: "single-file" | "subdirectory";
  /**
   * Regex-based patterns to match object names.
   * First matching pattern wins -- ordering controls priority.
   *
   * Examples:
   * - `{ pattern: /^project/, name: "project" }`  – prefix
   * - `{ pattern: /organization/, name: "organization" }` – contains
   * - `{ pattern: /tokens$/, name: "tokens" }` – suffix
   */
  patterns?: GroupingPattern[];
  /**
   * Automatically detect partitioned tables and group partitions with
   * their parent table.  Defaults to `true`.
   */
  autoDetectPartitions?: boolean;
  /**
   * Schemas to flatten: all objects are merged into one file per category.
   * e.g. `schemas/partman/tables.sql` instead of `schemas/partman/tables/foo.sql`.
   * Useful for small or extension schemas that don't need per-object files.
   */
  flatSchemas?: string[];
}

// ============================================================================
// Internal Types
// ============================================================================

export interface FilePath {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
}
