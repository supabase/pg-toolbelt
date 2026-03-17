/**
 * Group changes into declarative schema files and order them for readability.
 */

import { Effect } from "effect";
import type { Change } from "../change.types.ts";
import type { InvariantViolationError } from "../errors.ts";
import { getFilePath } from "./file-mapper.ts";
import type { FileCategory, FileMetadata, FilePath } from "./types.ts";
import { CATEGORY_PRIORITY } from "./types.ts";

interface FileGroup {
  path: string;
  category: FileCategory;
  metadata: FileMetadata;
  changes: Change[];
}

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

function sortChangesWithinFile(changes: Change[]): Change[] {
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

export const groupChangesByFile = Effect.fnUntraced(function* (
  changes: Change[],
  mapper: (
    change: Change,
  ) => Effect.Effect<FilePath, InvariantViolationError> = getFilePath,
) {
  const groups = new Map<string, FileGroup>();

  for (const change of changes) {
    const file = yield* mapper(change);

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

  for (const group of groups.values()) {
    group.changes = sortChangesWithinFile(group.changes);
  }

  return Array.from(groups.values()).sort(sortByCategory);
});

function sortByCategory(a: FileGroup, b: FileGroup): number {
  const categoryDiff =
    CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category];
  if (categoryDiff !== 0) return categoryDiff;

  return a.path.localeCompare(b.path);
}
