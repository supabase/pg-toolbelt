/**
 * Group changes into declarative schema files and order them.
 */

import type { Change } from "../change.types.ts";
import { getFilePath } from "./file-mapper.ts";
import type { FileCategory, FileMetadata, FilePath } from "./types.ts";
import { CATEGORY_PRIORITY } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

export interface FileGroup {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
  changes: Change[];
  minIndex: number;
  maxIndex: number;
  /** Max index among object-scope CREATE changes (excludes COMMENT/GRANT/ALTER). */
  createObjectMaxIndex: number;
}

// ============================================================================
// Sort Strategies
// ============================================================================

/**
 * How file groups are sorted relative to each other:
 *
 * - "topological": Use topological position as primary key, category as tiebreak.
 *   Best for detailed mode where each file has a narrow dependency range.
 *
 * - "category": Use CATEGORY_PRIORITY as primary key, path as tiebreak.
 *   Best for simple mode where each file spans many objects and the topological
 *   max can skew file ordering (one late-dependency table would drag all tables
 *   to a late position).
 */
export type FileSortStrategy = "topological" | "category";

// ============================================================================
// Grouping & Ordering
// ============================================================================

export function groupChangesByFile(
  changes: Change[],
  mapper: (change: Change) => FilePath = getFilePath,
  options?: { sortBy?: FileSortStrategy },
): FileGroup[] {
  const sortBy = options?.sortBy ?? "topological";
  const groups = new Map<string, FileGroup>();

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const file = mapper(change);

    const isCreateObject =
      change.operation === "create" && change.scope === "object";
    const existing = groups.get(file.path);
    if (!existing) {
      groups.set(file.path, {
        path: file.path,
        category: file.category,
        metadata: file.metadata,
        changes: [change],
        minIndex: index,
        maxIndex: index,
        createObjectMaxIndex: isCreateObject ? index : -1,
      });
      continue;
    }

    existing.changes.push(change);
    if (index < existing.minIndex) {
      existing.minIndex = index;
    }
    if (index > existing.maxIndex) {
      existing.maxIndex = index;
    }
    if (isCreateObject && index > existing.createObjectMaxIndex) {
      existing.createObjectMaxIndex = index;
    }
  }

  const sortFn =
    sortBy === "category" ? sortByCategory : sortByTopologicalOrder;
  return Array.from(groups.values()).sort(sortFn);
}

/**
 * Sort by category priority, then path for determinism.
 *
 * Used in simple mode where each category maps to one file. Topological
 * ordering within each file is preserved (changes are pushed in order),
 * so cross-category ordering only needs to follow the natural dependency
 * hierarchy encoded in CATEGORY_PRIORITY.
 */
function sortByCategory(a: FileGroup, b: FileGroup): number {
  const categoryDiff =
    CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
  if (categoryDiff !== 0) return categoryDiff;

  return a.path.localeCompare(b.path);
}

/**
 * Sort by topological position, then category, then path.
 *
 * Used in detailed mode where each file has a narrow dependency range.
 * Different file types use different representative indices:
 *
 * - Terminal categories (foreign_keys, policies, indexes) use maxIndex so all
 *   their dependencies are satisfied first.
 *
 * - Table files use createMaxIndex because they can contain early-indexed
 *   non-CREATE changes (e.g., ALTER SEQUENCE ... OWNED BY is grouped with
 *   the owning table but has a low topological index since sequences are
 *   created early). Using the CREATE TABLE's index ensures all dependencies
 *   (e.g., functions used in column DEFAULTs) are available.
 *
 * - Function/procedure/aggregate files use createMaxIndex because overloads
 *   with the same name are grouped into one file but may have different type
 *   dependencies (e.g., one overload takes a view type parameter that must
 *   be created first). Only CREATE operations are considered because ALTER
 *   (e.g., OWNER changes) don't affect function availability.
 *
 * - All other files use minIndex (earliest change position).
 */
function sortByTopologicalOrder(a: FileGroup, b: FileGroup): number {
  const TERMINAL_CATEGORIES = new Set([
    "foreign_keys",
    "policies",
    "indexes",
  ]);
  const CREATE_MAX_CATEGORIES = new Set([
    "tables",
    "functions",
    "procedures",
    "aggregates",
  ]);
  const effectiveIndex = (g: FileGroup): number => {
    if (TERMINAL_CATEGORIES.has(g.category)) return g.maxIndex;
    if (
      CREATE_MAX_CATEGORIES.has(g.category) &&
      g.createObjectMaxIndex >= 0
    ) {
      return g.createObjectMaxIndex;
    }
    return g.minIndex;
  };
  const aIndex = effectiveIndex(a);
  const bIndex = effectiveIndex(b);

  const topoDiff = aIndex - bIndex;
  if (topoDiff !== 0) return topoDiff;

  const categoryDiff =
    CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
  if (categoryDiff !== 0) return categoryDiff;

  return a.path.localeCompare(b.path);
}
