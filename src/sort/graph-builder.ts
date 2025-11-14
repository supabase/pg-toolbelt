import type { Change } from "../change.types.ts";
import type { GraphData, PgDependRow, PhaseSortOptions } from "./types.ts";

/**
 * Filter out dependency rows with "unknown:" prefixed stable IDs.
 *
 * The "unknown:" prefix indicates dependencies that cannot be resolved to stable IDs,
 * typically because the referenced or dependent object doesn't exist in the catalog
 * or cannot be uniquely identified. These are filtered out because they cannot be
 * reliably used for ordering.
 */
function filterUnknownDependencies(
  dependencyRows: PgDependRow[],
): PgDependRow[] {
  return dependencyRows.filter(
    (dependencyRow) =>
      !dependencyRow.referenced_stable_id.startsWith("unknown:") &&
      !dependencyRow.dependent_stable_id.startsWith("unknown:"),
  );
}

/**
 * Build the graph data structures from phase changes and dependency rows.
 */
export function buildGraphData(
  phaseChanges: Change[],
  dependencyRows: PgDependRow[],
  options: PhaseSortOptions,
): GraphData {
  const filteredDependencyRows = filterUnknownDependencies(dependencyRows);

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
export function findConsumerIndexes(
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
 * Check if a change accepts a dependency relationship.
 *
 * For changes that create multiple IDs, we check if ANY of the created IDs
 * accept the dependency. This is because if any created ID depends on the
 * referenced ID, the change should run after the producer.
 *
 * If the change creates no IDs, we use the provided dependentId (which may
 * be from pg_depend or a placeholder).
 */
export function changeAcceptsDependency(
  change: Change,
  createdIds: Set<string>,
  dependentId: string,
  referencedId: string,
): boolean {
  // If the change creates no IDs, use the provided dependentId
  if (createdIds.size === 0) {
    return change.acceptsDependency(dependentId, referencedId);
  }

  // Check if ANY of the created IDs accept the dependency
  // This handles cases where different created IDs may have different
  // dependency acceptance logic (e.g., CreateSequence only accepts
  // dependencies for the sequence ID, not column IDs)
  for (const createdId of createdIds) {
    if (change.acceptsDependency(createdId, referencedId)) {
      return true;
    }
  }

  return false;
}

/**
 * Build edges from pg_depend catalog rows.
 *
 * For each dependency row, we:
 * 1. Find producers that create the referenced ID
 * 2. Find consumers that depend on the dependent ID
 * 3. Check if each consumer accepts the dependency
 * 4. Add edges from producers to consumers
 */
export function buildEdgesFromCatalogDependencies(
  dependencyRows: PgDependRow[],
  phaseChanges: Change[],
  graphData: GraphData,
  registerEdge: (sourceIndex: number, targetIndex: number) => void,
): void {
  const filteredDependencyRows = filterUnknownDependencies(dependencyRows);
  for (const dependencyRow of filteredDependencyRows) {
    const referencedProducers = graphData.changeIndexesByCreatedId.get(
      dependencyRow.referenced_stable_id,
    );
    if (!referencedProducers || referencedProducers.size === 0) continue;

    const consumerIndexes = findConsumerIndexes(
      dependencyRow.dependent_stable_id,
      graphData,
    );
    if (consumerIndexes.size === 0) continue;

    for (const consumerIndex of consumerIndexes) {
      const consumerChange = phaseChanges[consumerIndex];
      const consumerCreates = graphData.createdStableIdSets[consumerIndex];

      // Use the actual dependent ID from pg_depend, not an arbitrary created ID
      const acceptsDependency = changeAcceptsDependency(
        consumerChange,
        consumerCreates,
        dependencyRow.dependent_stable_id,
        dependencyRow.referenced_stable_id,
      );

      if (!acceptsDependency) continue;

      // Track that this consumer requires the referenced ID
      graphData.requirementSets[consumerIndex].add(
        dependencyRow.referenced_stable_id,
      );

      // Add edges from all producers to this consumer
      for (const producerIndex of referencedProducers) {
        registerEdge(producerIndex, consumerIndex);
      }
    }
  }
}

/**
 * Build edges from explicit creates/requires relationships.
 *
 * This handles cases where dependencies aren't in pg_depend (e.g., privileges
 * computed from default privileges that don't exist in the database yet).
 * We iterate through explicitRequirementSets to ensure we catch all explicit
 * requirements, not just those that were also in pg_depend.
 *
 * For each explicit requirement, we check if the consumer accepts the dependency
 * by checking ALL of its created IDs (not just the first one), since different
 * created IDs may have different dependency acceptance logic.
 */
export function buildEdgesFromExplicitRequirements(
  phaseChanges: Change[],
  graphData: GraphData,
  registerEdge: (sourceIndex: number, targetIndex: number) => void,
): void {
  for (
    let consumerIndex = 0;
    consumerIndex < phaseChanges.length;
    consumerIndex++
  ) {
    const consumerChange = phaseChanges[consumerIndex];
    const consumerCreates = graphData.createdStableIdSets[consumerIndex];

    for (const requiredId of graphData.explicitRequirementSets[consumerIndex]) {
      const producerIndexes =
        graphData.changeIndexesByCreatedId.get(requiredId);
      if (!producerIndexes) continue;

      for (const producerIndex of producerIndexes) {
        if (producerIndex === consumerIndex) continue;

        // Check if the consumer accepts the dependency by checking ALL created IDs.
        // We use the required ID as the referenced ID, and check each created ID
        // as a potential dependent. If ANY created ID accepts the dependency,
        // we add the edge.
        //
        // For the dependentId parameter, we use a placeholder since we're checking
        // all created IDs internally. The actual dependent ID will be one of the
        // created IDs if the dependency is accepted.
        const acceptsDependency = changeAcceptsDependency(
          consumerChange,
          consumerCreates,
          consumerCreates.size > 0
            ? Array.from(consumerCreates)[0]
            : requiredId, // Fallback if no created IDs
          requiredId,
        );

        if (!acceptsDependency) continue;

        registerEdge(producerIndex, consumerIndex);
      }
    }
  }
}
