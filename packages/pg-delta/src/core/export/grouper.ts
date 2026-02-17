/**
 * Group changes into declarative schema files and order them for readability.
 */

import type { Change } from "../change.types.ts";
import { getFilePath } from "./file-mapper.ts";
import type { FileCategory, FileMetadata, FilePath } from "./types.ts";
import { CATEGORY_PRIORITY } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

interface FileGroup {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
  changes: Change[];
}

// ============================================================================
// Within-file ordering
// ============================================================================

const OPERATION_PRIORITY: Record<string, number> = {
  create: 0,
  alter: 1,
};

const SCOPE_PRIORITY: Record<string, number> = {
  object: 0,
  comment: 1,
  privilege: 2,
  default_privilege: 3,
  membership: 4,
};

/**
 * Sort changes within a file for readability:
 * 1. By operation: create → alter
 * 2. By scope: object → comment → privilege → default_privilege → membership
 * 3. Stable tie-break by original position
 */
function sortChangesWithinFile(changes: Change[]): Change[] {
  // Tag each change with its original index for stable tie-breaking.
  const tagged = changes.map((change, index) => ({ change, index }));
  tagged.sort((a, b) => {
    const opA = OPERATION_PRIORITY[a.change.operation] ?? 99;
    const opB = OPERATION_PRIORITY[b.change.operation] ?? 99;
    if (opA !== opB) return opA - opB;

    const scopeA =
      SCOPE_PRIORITY[(a.change as { scope?: string }).scope ?? "object"] ?? 99;
    const scopeB =
      SCOPE_PRIORITY[(b.change as { scope?: string }).scope ?? "object"] ?? 99;
    if (scopeA !== scopeB) return scopeA - scopeB;

    return a.index - b.index;
  });
  return tagged.map((t) => t.change);
}

// ============================================================================
// Grouping & Ordering
// ============================================================================

export function groupChangesByFile(
  changes: Change[],
  mapper: (change: Change) => FilePath = getFilePath,
): FileGroup[] {
  const groups = new Map<string, FileGroup>();

  for (const change of changes) {
    const file = mapper(change);

    const existing = groups.get(file.path);
    if (!existing) {
      groups.set(file.path, {
        path: file.path,
        category: file.category,
        metadata: file.metadata,
        changes: [change],
      });
      continue;
    }

    existing.changes.push(change);
  }

  // Sort within each file for readability.
  for (const group of groups.values()) {
    group.changes = sortChangesWithinFile(group.changes);
  }

  // Sort files by category priority, then alphabetically by path.
  return Array.from(groups.values()).sort(sortByCategory);
}

/**
 * Sort by category priority, then path for determinism.
 */
function sortByCategory(a: FileGroup, b: FileGroup): number {
  const categoryDiff =
    CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
  if (categoryDiff !== 0) return categoryDiff;

  return a.path.localeCompare(b.path);
}
