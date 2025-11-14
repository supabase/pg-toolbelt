import type { Change } from "../change.types.ts";
import type { ConstraintSpec, Edge } from "./types.ts";

/**
 * Predicate for selecting changes targeted by a constraint spec.
 */
type ChangeFilter =
  | Partial<Pick<Change, "operation" | "objectType" | "scope">>
  | ((change: Change) => boolean);

/**
 * Build edges from user-defined constraint specs (applied within the phase).
 *
 * The algorithm:
 * - Select the items via spec.filter (or all items if not provided)
 * - Optionally partition by spec.groupBy, then apply edges within each group
 * - buildEdges can provide explicit edges; pairwise can declare local ordering
 */
export function generateConstraintEdges(
  items: Change[],
  specs: ConstraintSpec<Change>[],
): Array<[number, number]> {
  const globalIndexByChange = new Map<Change, number>();
  for (let changeIndex = 0; changeIndex < items.length; changeIndex++) {
    globalIndexByChange.set(items[changeIndex], changeIndex);
  }

  const edges: Array<[number, number]> = [];
  for (const spec of specs) {
    const filteredItems = items.filter((changeItem) =>
      changeMatchesFilter(changeItem, spec.filter),
    );
    if (filteredItems.length === 0) continue;

    // If no groupBy is specified, treat all filtered items as a single group.
    // We use a sentinel key since the algorithm iterates over groups.
    const groupedItems = spec.groupBy
      ? groupChangesByKey(filteredItems, spec.groupBy)
      : new Map<string, Change[]>([["__all__", filteredItems]]);

    for (const groupItems of groupedItems.values()) {
      if (groupItems.length <= 1) continue;
      if (spec.buildEdges) {
        for (const edge of spec.buildEdges(groupItems)) {
          addEdgeFromSpec(edge, groupItems, globalIndexByChange, edges);
        }
      }

      if (spec.pairwise) {
        for (let leftIndex = 0; leftIndex < groupItems.length; leftIndex++) {
          for (
            let rightIndex = 0;
            rightIndex < groupItems.length;
            rightIndex++
          ) {
            if (leftIndex === rightIndex) continue;
            const decision = spec.pairwise(
              groupItems[leftIndex],
              groupItems[rightIndex],
            );
            if (!decision) continue;
            const sourceIndex = globalIndexByChange.get(groupItems[leftIndex]);
            const targetIndex = globalIndexByChange.get(groupItems[rightIndex]);
            if (
              sourceIndex === undefined ||
              targetIndex === undefined ||
              sourceIndex === targetIndex
            ) {
              continue;
            }
            edges.push(
              decision === "a_before_b"
                ? [sourceIndex, targetIndex]
                : [targetIndex, sourceIndex],
            );
          }
        }
      }
    }
  }
  return edges;
}

/**
 * Add an edge from a constraint spec to the edges array.
 */
function addEdgeFromSpec(
  edge: Edge<Change>,
  groupItems: Change[],
  globalIndexByChange: Map<Change, number>,
  edges: Array<[number, number]>,
): void {
  if (Array.isArray(edge)) {
    const [sourceLocalIndex, targetLocalIndex] = edge;
    const sourceIndex = globalIndexByChange.get(groupItems[sourceLocalIndex]);
    const targetIndex = globalIndexByChange.get(groupItems[targetLocalIndex]);
    if (
      sourceIndex !== undefined &&
      targetIndex !== undefined &&
      sourceIndex !== targetIndex
    ) {
      edges.push([sourceIndex, targetIndex]);
    }
  } else {
    const sourceIndex = globalIndexByChange.get(edge.from);
    const targetIndex = globalIndexByChange.get(edge.to);
    if (
      sourceIndex !== undefined &&
      targetIndex !== undefined &&
      sourceIndex !== targetIndex
    ) {
      edges.push([sourceIndex, targetIndex]);
    }
  }
}

/** Matches a change against a filter (object or predicate). */
function changeMatchesFilter(change: Change, filter?: ChangeFilter): boolean {
  if (!filter) return true;
  if (typeof filter === "function") return filter(change);
  if (filter.operation !== undefined && change.operation !== filter.operation)
    return false;
  if (
    filter.objectType !== undefined &&
    change.objectType !== filter.objectType
  ) {
    return false;
  }
  if (filter.scope !== undefined && change.scope !== filter.scope) return false;
  return true;
}

/** Groups items by a key function (undefined/null map to a sentinel bucket). */
function groupChangesByKey<TItem>(
  items: TItem[],
  keySelector: (item: TItem) => string | null | undefined,
) {
  const groupedItems = new Map<string, TItem[]>();
  for (const item of items) {
    // Map null/undefined keys to a sentinel value since Map keys must be strings
    const bucketKey = keySelector(item) ?? "__null__";
    const existingBucket = groupedItems.get(bucketKey);
    if (existingBucket) {
      existingBucket.push(item);
    } else {
      groupedItems.set(bucketKey, [item]);
    }
  }
  return groupedItems;
}
