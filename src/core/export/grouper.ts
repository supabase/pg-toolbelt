/**
 * Group changes into declarative schema files and order them.
 */

import type { Change } from "../change.types.ts";
import { getFilePath } from "./file-mapper.ts";
import { CATEGORY_PRIORITY } from "./types.ts";
import type { FileCategory, FileMetadata } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

export interface FileGroup {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
  changes: Change[];
  minIndex: number;
}

// ============================================================================
// Grouping & Ordering
// ============================================================================

export function groupChangesByFile(changes: Change[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();

  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    const file = getFilePath(change);

    const existing = groups.get(file.path);
    if (!existing) {
      groups.set(file.path, {
        path: file.path,
        category: file.category,
        metadata: file.metadata,
        changes: [change],
        minIndex: index,
      });
      continue;
    }

    existing.changes.push(change);
    if (index < existing.minIndex) {
      existing.minIndex = index;
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const categoryDiff =
      CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
    if (categoryDiff !== 0) return categoryDiff;

    const topoDiff = a.minIndex - b.minIndex;
    if (topoDiff !== 0) return topoDiff;

    return a.path.localeCompare(b.path);
  });
}
