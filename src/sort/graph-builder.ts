import type { Change } from "../change.types.ts";
import { stableId } from "../objects/utils.ts";
import type {
  Dependency,
  GraphData,
  PgDependRow,
  PhaseSortOptions,
} from "./types.ts";

/**
 * Filter out dependencies that should not be processed.
 *
 * This applies all filtering logic:
 * - Unknown dependencies (with "unknown:" prefix)
 * - Sequence ownership dependencies (to prevent cycles)
 * - Any other filters as needed
 */
function filterDependencies(
  dependencies: Dependency[],
  phaseChanges: Change[],
  graphData: GraphData,
): Dependency[] {
  return dependencies.filter((dependency) => {
    // Filter out unknown dependencies
    if (
      dependency.referenced_stable_id.startsWith("unknown:") ||
      dependency.dependent_stable_id.startsWith("unknown:")
    ) {
      return false;
    }

    // Filter out sequence ownership dependencies to prevent cycles
    if (
      shouldFilterSequenceOwnershipDependency(
        dependency.dependent_stable_id,
        dependency.referenced_stable_id,
        phaseChanges,
        graphData,
      )
    ) {
      return false;
    }

    return true;
  });
}

/**
 * Convert catalog dependencies (PgDependRow) to dependencies.
 */
export function convertCatalogDependencies(
  dependencyRows: PgDependRow[],
): Dependency[] {
  return dependencyRows.map((row) => ({
    dependent_stable_id: row.dependent_stable_id,
    referenced_stable_id: row.referenced_stable_id,
    source: "catalog" as const,
  }));
}

/**
 * Convert explicit requirements to dependencies.
 *
 * For each change that explicitly requires something:
 * - If the change creates stable IDs, we create dependencies from each created ID to each required ID
 * - If the change doesn't create anything but requires something, we skip creating dependencies here
 *   because these are handled directly in buildEdgesFromDependencies by iterating over changes
 *   and their requirements (via changeIndexesByExplicitRequirementId)
 */
export function convertExplicitRequirements(
  phaseChanges: Change[],
  graphData: GraphData,
): Dependency[] {
  const dependencies: Dependency[] = [];

  for (
    let consumerIndex = 0;
    consumerIndex < phaseChanges.length;
    consumerIndex++
  ) {
    const createdIds = graphData.createdStableIdSets[consumerIndex];
    const requiredIds = graphData.explicitRequirementSets[consumerIndex];

    if (requiredIds.size === 0) continue;

    // Only create dependencies for changes that create stable IDs
    // Changes that don't create anything are handled directly in buildEdgesFromDependencies
    if (createdIds.size > 0) {
      for (const requiredId of requiredIds) {
        for (const createdId of createdIds) {
          dependencies.push({
            dependent_stable_id: createdId,
            referenced_stable_id: requiredId,
            source: "explicit" as const,
          });
        }
      }
    }
  }

  return dependencies;
}

/**
 * Build the graph data structures from phase changes and dependency rows.
 */
export function buildGraphData(
  phaseChanges: Change[],
  dependencyRows: PgDependRow[],
  options: PhaseSortOptions,
): GraphData {
  // Note: We still use PgDependRow here for the initial build, but will convert
  // to Dependency when building edges
  const filteredDependencyRows = dependencyRows.filter(
    (row) =>
      !row.referenced_stable_id.startsWith("unknown:") &&
      !row.dependent_stable_id.startsWith("unknown:"),
  );

  // Build map of referenced_id -> set of dependent_ids (from pg_depend)
  // Used for debug visualization and understanding dependency relationships
  const dependenciesByReferencedId = new Map<string, Set<string>>();
  for (const dependencyRow of filteredDependencyRows) {
    let dependentIds = dependenciesByReferencedId.get(
      dependencyRow.referenced_stable_id,
    );
    if (!dependentIds) {
      dependentIds = new Set<string>();
      dependenciesByReferencedId.set(
        dependencyRow.referenced_stable_id,
        dependentIds,
      );
    }
    dependentIds.add(dependencyRow.dependent_stable_id);
  }

  // For each change, collect the stable IDs it creates.
  // In DROP phase (invert=true), we also include dropped IDs since drops
  // need to be ordered based on what they remove.
  const createdStableIdSets: Array<Set<string>> = phaseChanges.map(
    (changeItem) => {
      const createdIds = new Set<string>(changeItem.creates);
      if (options.invert) {
        for (const droppedId of changeItem.drops ?? []) {
          createdIds.add(droppedId);
        }
      }
      return createdIds;
    },
  );

  // For each change, collect the stable IDs it explicitly requires.
  const explicitRequirementSets: Array<Set<string>> = phaseChanges.map(
    (changeItem) => new Set<string>(changeItem.requires ?? []),
  );

  // Track all requirements (explicit + inferred from pg_depend).
  // This starts as a copy of explicit requirements and will be extended
  // as we process pg_depend rows.
  const requirementSets: Array<Set<string>> = explicitRequirementSets.map(
    (explicitRequirements) => new Set<string>(explicitRequirements),
  );

  // Build reverse index: stable_id -> set of change indices that create it
  const changeIndexesByCreatedId = new Map<string, Set<number>>();
  for (let changeIndex = 0; changeIndex < phaseChanges.length; changeIndex++) {
    for (const createdId of createdStableIdSets[changeIndex]) {
      let producerIndexes = changeIndexesByCreatedId.get(createdId);
      if (!producerIndexes) {
        producerIndexes = new Set<number>();
        changeIndexesByCreatedId.set(createdId, producerIndexes);
      }
      producerIndexes.add(changeIndex);
    }
  }

  // Build reverse index: stable_id -> set of change indices that explicitly require it
  const changeIndexesByExplicitRequirementId = new Map<string, Set<number>>();
  for (
    let changeIndex = 0;
    changeIndex < explicitRequirementSets.length;
    changeIndex++
  ) {
    for (const requiredId of explicitRequirementSets[changeIndex]) {
      let consumerIndexes =
        changeIndexesByExplicitRequirementId.get(requiredId);
      if (!consumerIndexes) {
        consumerIndexes = new Set<number>();
        changeIndexesByExplicitRequirementId.set(requiredId, consumerIndexes);
      }
      consumerIndexes.add(changeIndex);
    }
  }

  return {
    createdStableIdSets,
    explicitRequirementSets,
    requirementSets,
    changeIndexesByCreatedId,
    changeIndexesByExplicitRequirementId,
    dependenciesByReferencedId,
  };
}

/**
 * Find all change indices that could be consumers for a given dependent stable ID.
 *
 * A consumer is either:
 * 1. A change that explicitly requires the dependent ID, OR
 * 2. A change that creates the dependent ID (since creating something implies
 *    it depends on its own dependencies)
 */
function findConsumerIndexes(
  dependentStableId: string,
  graphData: GraphData,
): Set<number> {
  const consumerIndexes = new Set<number>();

  // Add changes that explicitly require this ID
  const explicitConsumerIndexes =
    graphData.changeIndexesByExplicitRequirementId.get(dependentStableId);
  if (explicitConsumerIndexes) {
    for (const consumerIndex of explicitConsumerIndexes) {
      consumerIndexes.add(consumerIndex);
    }
  }

  // Add changes that create this ID (they are consumers of dependencies)
  const dependentProducers =
    graphData.changeIndexesByCreatedId.get(dependentStableId);
  if (dependentProducers) {
    for (const producerIndex of dependentProducers) {
      consumerIndexes.add(producerIndex);
    }
  }

  return consumerIndexes;
}

/**
 * Check if a sequence is owned by a given table or column.
 *
 * This is used to identify sequence ownership dependencies that should be filtered
 * to prevent cycles when sequences are used by table columns (SERIAL columns).
 *
 * @param sequence - The sequence object to check
 * @param referencedStableId - The stable ID being referenced (table or column)
 * @returns true if the sequence is owned by the referenced table/column
 */
function isSequenceOwnedBy(
  sequence: {
    owned_by_schema: string | null;
    owned_by_table: string | null;
    owned_by_column: string | null;
  },
  referencedStableId: string,
): boolean {
  if (
    !sequence.owned_by_schema ||
    !sequence.owned_by_table ||
    !sequence.owned_by_column
  ) {
    return false;
  }

  const ownedByTableId = stableId.table(
    sequence.owned_by_schema,
    sequence.owned_by_table,
  );
  const ownedByColumnId = stableId.column(
    sequence.owned_by_schema,
    sequence.owned_by_table,
    sequence.owned_by_column,
  );

  return (
    referencedStableId === ownedByTableId ||
    referencedStableId === ownedByColumnId
  );
}

/**
 * Check if a sequence ownership dependency should be filtered out to prevent cycles.
 *
 * When a sequence is owned by a table column that also uses the sequence (via DEFAULT),
 * this creates a cycle:
 * - sequence → table/column (ownership)
 * - table/column → sequence (column default)
 *
 * This cycle would occur in both CREATE and DROP phases:
 * - CREATE: sequence → table (ownership) and table → sequence (column default)
 * - DROP (inverted): table → sequence (ownership) and sequence → table (column default)
 *
 * We filter out the ownership dependency because:
 * - CREATE phase: sequences should be created before tables (ownership set via ALTER SEQUENCE OWNED BY after both exist)
 * - DROP phase: prevents cycles when dropping sequences owned by tables that aren't being dropped
 *
 * Note: We only filter CreateSequence, not AlterSequenceSetOwnedBy, because the ALTER
 * needs to wait for the table/column to exist before it can set OWNED BY.
 *
 * @param sequenceStableId - The stable ID of the sequence (dependent)
 * @param referencedStableId - The stable ID being referenced (table or column)
 * @param phaseChanges - All changes in the current phase
 * @param graphData - Graph data structures for finding consumers
 * @returns true if this dependency should be filtered out (skipped)
 */
function shouldFilterSequenceOwnershipDependency(
  sequenceStableId: string,
  referencedStableId: string,
  phaseChanges: Change[],
  graphData: GraphData,
): boolean {
  // Pattern match: sequence → table/column
  if (
    !sequenceStableId.startsWith("sequence:") ||
    (!referencedStableId.startsWith("table:") &&
      !referencedStableId.startsWith("column:"))
  ) {
    return false;
  }

  // Find all consumers of the sequence and check if any match
  const sequenceConsumers = findConsumerIndexes(sequenceStableId, graphData);

  for (const consumerIndex of sequenceConsumers) {
    const change = phaseChanges[consumerIndex];
    // Only filter CreateSequence, not AlterSequenceSetOwnedBy
    if (change.constructor.name !== "CreateSequence") {
      continue;
    }

    // Check if this is a sequence change (create or drop) with ownership matching the referenced ID
    if (change.objectType === "sequence" && "sequence" in change) {
      if (isSequenceOwnedBy(change.sequence, referencedStableId)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Build edges from dependencies (catalog + explicit).
 *
 * This function processes all dependencies uniformly:
 * 1. Filters out dependencies that should be skipped (unknown, sequence ownership, etc.)
 * 2. Finds producers that create the referenced ID
 * 3. Finds consumers that depend on the dependent ID
 * 4. Adds edges from producers to consumers
 *
 * Additionally, it handles changes that don't create anything but require something
 * by directly iterating over their requirements.
 */
export function buildEdgesFromDependencies(
  dependencies: Dependency[],
  phaseChanges: Change[],
  graphData: GraphData,
  registerEdge: (sourceIndex: number, targetIndex: number) => void,
): void {
  // Apply all filtering logic in one place
  const filteredDependencies = filterDependencies(
    dependencies,
    phaseChanges,
    graphData,
  );

  // Process dependencies from catalog and explicit requirements (for changes that create IDs)
  for (const dependency of filteredDependencies) {
    // Find producers that create the referenced ID
    const referencedProducers = graphData.changeIndexesByCreatedId.get(
      dependency.referenced_stable_id,
    );
    if (!referencedProducers || referencedProducers.size === 0) continue;

    // Find consumers that depend on the dependent ID
    // This works for both catalog and explicit dependencies
    const consumerIndexes = findConsumerIndexes(
      dependency.dependent_stable_id,
      graphData,
    );

    if (consumerIndexes.size === 0) continue;

    // Add edges from all producers to all consumers
    for (const consumerIndex of consumerIndexes) {
      // Track that this consumer requires the referenced ID
      graphData.requirementSets[consumerIndex].add(
        dependency.referenced_stable_id,
      );

      for (const producerIndex of referencedProducers) {
        if (producerIndex === consumerIndex) continue;
        registerEdge(producerIndex, consumerIndex);
      }
    }
  }

  // Handle changes that don't create anything but require something
  // These aren't represented in dependencies, so we process them directly
  for (
    let consumerIndex = 0;
    consumerIndex < phaseChanges.length;
    consumerIndex++
  ) {
    const createdIds = graphData.createdStableIdSets[consumerIndex];
    const requiredIds = graphData.explicitRequirementSets[consumerIndex];

    // Skip changes that create IDs (already handled above) or have no requirements
    if (createdIds.size > 0 || requiredIds.size === 0) continue;

    // For each requirement, find producers and add edges
    for (const requiredId of requiredIds) {
      const referencedProducers =
        graphData.changeIndexesByCreatedId.get(requiredId);
      if (!referencedProducers || referencedProducers.size === 0) continue;

      // Track that this consumer requires the referenced ID
      graphData.requirementSets[consumerIndex].add(requiredId);

      // Add edges from all producers to this consumer
      for (const producerIndex of referencedProducers) {
        if (producerIndex === consumerIndex) continue;
        registerEdge(producerIndex, consumerIndex);
      }
    }
  }
}
