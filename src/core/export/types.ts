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
  indexes: 14,
  policies: 15,
  foreign_keys: 16,
  // Late-binding cluster objects that depend on schema-level objects.
  // In detailed mode these use "cluster" and rely on topological sort.
  // In simple mode they need explicit late ordering.
  publications: 17,
  subscriptions: 18,
  event_triggers: 19,
} as const;

export type FileCategory = keyof typeof CATEGORY_PRIORITY;

/**
 * Export mode controls file organization:
 * - "detailed": One file per object in nested directories (e.g., schemas/public/tables/users.sql)
 * - "simple": One file per category, flat structure (e.g., tables.sql, views.sql)
 */
export type ExportMode = "detailed" | "simple";

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
// Internal Types
// ============================================================================

export interface FilePath {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
}
