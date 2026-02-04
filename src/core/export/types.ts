/**
 * Type definitions for declarative schema export.
 */

// ============================================================================
// File Categories
// ============================================================================

export const CATEGORY_PRIORITY = {
  cluster: 0,
  schema: 1,
  types: 2,
  sequences: 3,
  tables: 4,
  foreign_tables: 5,
  views: 6,
  matviews: 7,
  functions: 8,
  procedures: 9,
  aggregates: 10,
  domains: 11,
  collations: 12,
  indexes: 13,
  policies: 14,
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
// Internal Types
// ============================================================================

export interface FilePath {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
}
