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
// Internal Types
// ============================================================================

export interface FilePath {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
}
