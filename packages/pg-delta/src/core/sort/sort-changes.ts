/**
 * Phased dependency-graph sort for ordered schema changes.
 *
 * Changes are split into two execution phases:
 * - `drop`: Destructive operations (executed first, in reverse dependency order)
 * - `create_alter_object`: All remaining changes (executed second, in forward dependency order)
 *
 * Within each phase, changes are sorted using Constraints derived from:
 * - Catalog dependencies (from pg_depend)
 * - Explicit requirements (from Change.requires)
 * - Custom constraints (change-to-change ordering rules)
 */

import debug from "debug";
import type { Catalog } from "../catalog.model.ts";
import type { Change } from "../change.types.ts";
import { generateCustomConstraints } from "./custom-constraints.ts";
import { tryBreakCycleByChangeInjection } from "./cycle-breakers.ts";
import { printDebugGraph } from "./debug-visualization.ts";

const debugGraph = debug("pg-delta:graph");

import {
  filterEdgesForCycleBreaking,
  getEdgesInCycle,
} from "./dependency-filter.ts";
import {
  buildGraphData,
  convertCatalogDependenciesToConstraints,
  convertConstraintsToEdges,
  convertExplicitRequirementsToConstraints,
  edgesToPairs,
} from "./graph-builder.ts";
import { dedupeEdges } from "./graph-utils.ts";
import { logicalSort } from "./logical-sort.ts";
import {
  findCycle,
  formatCycleError,
  performStableTopologicalSort,
} from "./topological-sort.ts";
import type { PgDependRow, PhaseSortOptions } from "./types.ts";
import { getExecutionPhase, type Phase } from "./utils.ts";

// Bound on how many times the change-injection cycle breaker may rewrite a
// single phase's change list before we give up. Each successful injection
// strictly reduces the number of unbreakable cycles (it either replaces an
// `AlterTableDropColumn` with a non-cycling variant, or it adds dedicated
// constraint drops that own previously contested stable-ids), so a healthy
// schema converges in 1–2 rounds. The cap exists only to surface buggy
// breakers as `CycleError` instead of an infinite loop.
const MAX_CYCLE_BREAKER_ROUNDS = 5;

/**
 * Sort changes using dependency information from catalogs and custom constraints.
 *
 * First applies logical pre-sorting to group related changes together,
 * then applies dependency-based topological sorting to ensure correct execution order.
 *
 * @param catalogs - Main and branch catalogs containing dependency information
 * @param changes - List of Change objects to order
 * @returns Ordered list of Change objects
 */
export function sortChanges(
  catalogs: { mainCatalog: Catalog; branchCatalog: Catalog },
  changes: Change[],
): Change[] {
  // Step 1: Apply logical pre-sorting to group changes by object type, stable ID, and scope
  const logicallySorted = logicalSort(changes);

  // Step 2: Apply dependency-based topological sorting
  return sortChangesByPhasedGraph(
    {
      mainCatalog: { depends: catalogs.mainCatalog.depends },
      branchCatalog: { depends: catalogs.branchCatalog.depends },
    },
    logicallySorted,
  );
}

/**
 * Sort changes by phases, using dependency information in each phase.
 *
 * @param catalogContext - pg_depend rows from the main and branch catalogs
 * @param changeList - list of Change objects to order
 * @returns ordered list of Change objects
 */
function sortChangesByPhasedGraph(
  catalogContext: {
    mainCatalog: { depends: PgDependRow[] };
    branchCatalog: { depends: PgDependRow[] };
  },
  changeList: Change[],
): Change[] {
  const changesByPhase: Record<Phase, Change[]> = {
    drop: [],
    create_alter_object: [],
  };

  // Partition changes into execution phases
  for (const changeItem of changeList) {
    const phase = getExecutionPhase(changeItem);
    changesByPhase[phase].push(changeItem);
  }

  // Sort DROP phase: reverse dependency order using main catalog dependencies
  const sortedDropPhase = sortPhaseChanges(
    changesByPhase.drop,
    catalogContext.mainCatalog.depends,
    { invert: true },
  );

  // Sort CREATE/ALTER phase: forward dependency order using branch catalog dependencies
  const sortedCreateAlterPhase = sortPhaseChanges(
    changesByPhase.create_alter_object,
    catalogContext.branchCatalog.depends,
    {},
  );

  return [...sortedDropPhase, ...sortedCreateAlterPhase];
}

/**
 * Normalize a cycle by rotating it to start with the smallest node index, so
 * cycles that loop through the same nodes in the same direction compare equal
 * regardless of where DFS happened to enter them.
 */
function normalizeCycle(cycleNodeIndexes: number[]): string {
  if (cycleNodeIndexes.length === 0) return "";
  const minIndex = Math.min(...cycleNodeIndexes);
  const minIndexPos = cycleNodeIndexes.indexOf(minIndex);
  const rotated = [
    ...cycleNodeIndexes.slice(minIndexPos),
    ...cycleNodeIndexes.slice(0, minIndexPos),
  ];
  return rotated.join(",");
}

type SortRoundResult =
  | { kind: "sorted"; sorted: Change[] }
  | {
      kind: "unbreakable";
      cycleNodeIndexes: number[];
      cycleEdges: ReturnType<typeof getEdgesInCycle>;
    };

/**
 * One attempt at sorting `phaseChanges`. Builds the graph from scratch,
 * runs the iterative edge-removal cycle handler, and either returns a
 * topologically sorted list or reports an unbreakable cycle so the caller
 * can decide whether to dispatch a change-injection breaker.
 *
 * Algorithm:
 * 1. Build graph data (change sets and reverse indexes).
 * 2. Convert all sources to Constraints (catalog, explicit, custom).
 * 3. Convert Constraints to edges.
 * 4. Iteratively detect and break cycles by removing weak edges.
 * 5. Perform stable topological sort on the acyclic graph.
 *
 * In DROP phase, edges are inverted so drops run in reverse dependency
 * order.
 */
function attemptSortRound(
  phaseChanges: Change[],
  dependencyRows: PgDependRow[],
  options: PhaseSortOptions,
): SortRoundResult {
  // Step 1: Build graph data structures
  const graphData = buildGraphData(phaseChanges, options);

  // Step 2: Convert all sources to Constraints
  const catalogConstraints = convertCatalogDependenciesToConstraints(
    dependencyRows,
    graphData,
  );
  const explicitConstraints = convertExplicitRequirementsToConstraints(
    phaseChanges,
    graphData,
  );
  const customConstraintObjects = generateCustomConstraints(phaseChanges);
  const allConstraints = [
    ...catalogConstraints,
    ...explicitConstraints,
    ...customConstraintObjects,
  ];

  // Step 3: Convert constraints to edges and deduplicate immediately
  let edges = dedupeEdges(convertConstraintsToEdges(allConstraints, options));

  // Step 4: Iteratively detect and break cycles by edge filtering.
  // We loop until no cycles remain OR we see the same cycle twice — the
  // latter signals that edge filtering exhausted itself. At that point
  // the caller may dispatch a change-injection breaker; if no breaker
  // matches, the original throw path runs.
  const seenCycles = new Set<string>();

  while (true) {
    const edgePairs = edgesToPairs(edges);
    const cycleNodeIndexes = findCycle(phaseChanges.length, edgePairs);

    if (!cycleNodeIndexes) break;

    const cycleSignature = normalizeCycle(cycleNodeIndexes);
    if (seenCycles.has(cycleSignature)) {
      // Edge filtering can't break this cycle. Report it back to the
      // caller so it can try change-injection before throwing.
      return {
        kind: "unbreakable",
        cycleNodeIndexes,
        cycleEdges: getEdgesInCycle(cycleNodeIndexes, edges),
      };
    }
    seenCycles.add(cycleSignature);

    edges = filterEdgesForCycleBreaking(
      edges,
      cycleNodeIndexes,
      phaseChanges,
      graphData,
    );
  }

  const finalEdgePairs = edgesToPairs(edges);

  if (debugGraph.enabled) {
    printDebugGraph(
      phaseChanges,
      graphData,
      finalEdgePairs,
      dependencyRows,
      allConstraints,
    );
  }

  // Step 5: Perform stable topological sort (no cycles, so this will succeed)
  const topologicalOrder = performStableTopologicalSort(
    phaseChanges.length,
    finalEdgePairs,
  );

  if (!topologicalOrder || topologicalOrder.length !== phaseChanges.length) {
    // This should never happen if findCycle returned null, but guard anyway
    throw new Error("CycleError: dependency graph contains a cycle");
  }

  return {
    kind: "sorted",
    sorted: topologicalOrder.map((changeIndex) => phaseChanges[changeIndex]),
  };
}

/**
 * Sort changes within a phase. Tries `attemptSortRound`; on an unbreakable
 * cycle, dispatches to `tryBreakCycleByChangeInjection`, retries with the
 * rewritten changes, and bails after `MAX_CYCLE_BREAKER_ROUNDS` to surface
 * a buggy breaker as `CycleError` instead of an infinite loop.
 *
 * Best case (no cycles, the vast majority of plans): one round, no
 * change-injection breaker code runs at all.
 */
function sortPhaseChanges(
  initialPhaseChanges: Change[],
  dependencyRows: PgDependRow[],
  options: PhaseSortOptions = {},
): Change[] {
  if (initialPhaseChanges.length <= 1) return initialPhaseChanges;

  let phaseChanges = initialPhaseChanges;
  const breakerRoundSignatures = new Set<string>();

  for (let round = 0; round <= MAX_CYCLE_BREAKER_ROUNDS; round++) {
    const result = attemptSortRound(phaseChanges, dependencyRows, options);
    if (result.kind === "sorted") return result.sorted;

    // Edge filtering hit an unbreakable cycle. Try the change-injection
    // breakers (FK pattern, publication↔column pattern). If none matches,
    // throw with the same diagnostic the original code emitted.
    const broken = tryBreakCycleByChangeInjection(
      result.cycleNodeIndexes,
      phaseChanges,
    );
    if (broken === null) {
      throw new Error(
        formatCycleError(
          result.cycleNodeIndexes,
          phaseChanges,
          result.cycleEdges,
        ),
      );
    }

    // Loop guard: if the same cycle node-set re-appears after a break,
    // the breaker isn't making progress. Throw with full context.
    const signature = normalizeCycle(result.cycleNodeIndexes);
    if (breakerRoundSignatures.has(signature)) {
      throw new Error(
        formatCycleError(
          result.cycleNodeIndexes,
          phaseChanges,
          result.cycleEdges,
        ),
      );
    }
    breakerRoundSignatures.add(signature);

    phaseChanges = broken;
  }

  throw new Error(
    `CycleError: change-injection breaker exceeded ${MAX_CYCLE_BREAKER_ROUNDS} rounds — likely a buggy breaker rule`,
  );
}
