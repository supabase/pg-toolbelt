import type { StatementClass } from "../classify/classify-statement.ts";
import type { PhaseTag, StatementNode } from "../model/types.ts";

type TopoSortResult = {
  orderedIndices: number[];
  cycleGroups: number[][];
};

const PHASE_WEIGHT: Record<PhaseTag, number> = {
  bootstrap: 0,
  pre_data: 1,
  data_structures: 2,
  routines: 3,
  post_data: 4,
  privileges: 5,
};

// Keep this pg_dump-inspired ordering as a deterministic tie-breaker
// only when dependency edges do not already force an order.
const STATEMENT_CLASS_WEIGHT: Partial<Record<StatementClass, number>> = {
  CREATE_ROLE: 0,
  CREATE_SCHEMA: 1,
  CREATE_EXTENSION: 2,
  CREATE_LANGUAGE: 3,
  CREATE_FOREIGN_DATA_WRAPPER: 4,
  CREATE_FOREIGN_SERVER: 5,
  VARIABLE_SET: 6,
  DO: 7,

  CREATE_TYPE: 10,
  CREATE_DOMAIN: 11,
  CREATE_COLLATION: 12,
  CREATE_SEQUENCE: 13,
  ALTER_SEQUENCE: 14,

  CREATE_TABLE: 20,
  ALTER_TABLE: 21,

  CREATE_FUNCTION: 30,
  CREATE_PROCEDURE: 31,
  CREATE_AGGREGATE: 32,

  CREATE_VIEW: 40,
  CREATE_MATERIALIZED_VIEW: 41,
  CREATE_INDEX: 42,
  CREATE_TRIGGER: 43,
  CREATE_EVENT_TRIGGER: 44,
  CREATE_POLICY: 45,
  CREATE_PUBLICATION: 46,
  CREATE_SUBSCRIPTION: 47,
  SELECT: 48,
  UPDATE: 49,

  ALTER_OWNER: 50,
  COMMENT: 51,
  GRANT: 52,
  REVOKE: 53,
  ALTER_DEFAULT_PRIVILEGES: 54,
};

const statementClassWeight = (statementClass: StatementClass): number =>
  STATEMENT_CLASS_WEIGHT[statementClass] ?? Number.MAX_SAFE_INTEGER;

export const compareStatementIndices = (
  leftIndex: number,
  rightIndex: number,
  nodes: StatementNode[],
): number => {
  const left = nodes[leftIndex];
  const right = nodes[rightIndex];
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }

  const phaseDelta = PHASE_WEIGHT[left.phase] - PHASE_WEIGHT[right.phase];
  if (phaseDelta !== 0) {
    return phaseDelta;
  }

  const classDelta =
    statementClassWeight(left.statementClass) -
    statementClassWeight(right.statementClass);
  if (classDelta !== 0) {
    return classDelta;
  }

  const pathDelta = left.id.filePath.localeCompare(right.id.filePath);
  if (pathDelta !== 0) {
    return pathDelta;
  }

  const statementDelta = left.id.statementIndex - right.id.statementIndex;
  if (statementDelta !== 0) {
    return statementDelta;
  }

  return left.statementClass.localeCompare(right.statementClass);
};

const insertSorted = (
  queue: number[],
  value: number,
  nodes: StatementNode[],
): void => {
  let insertIndex = queue.findIndex(
    (existingValue) => compareStatementIndices(value, existingValue, nodes) < 0,
  );
  if (insertIndex < 0) {
    insertIndex = queue.length;
  }
  queue.splice(insertIndex, 0, value);
};

const stronglyConnectedComponents = (
  edges: Map<number, Set<number>>,
  activeNodeIndices: Set<number>,
): number[][] => {
  const indexByNode = new Map<number, number>();
  const lowLinkByNode = new Map<number, number>();
  const stack: number[] = [];
  const onStack = new Set<number>();
  const components: number[][] = [];
  let currentIndex = 0;

  const visit = (nodeIndex: number): void => {
    indexByNode.set(nodeIndex, currentIndex);
    lowLinkByNode.set(nodeIndex, currentIndex);
    currentIndex += 1;

    stack.push(nodeIndex);
    onStack.add(nodeIndex);

    const neighbors = edges.get(nodeIndex) ?? new Set<number>();
    for (const neighbor of neighbors) {
      if (!activeNodeIndices.has(neighbor)) {
        continue;
      }

      if (!indexByNode.has(neighbor)) {
        visit(neighbor);
        lowLinkByNode.set(
          nodeIndex,
          Math.min(
            lowLinkByNode.get(nodeIndex) ?? Number.POSITIVE_INFINITY,
            lowLinkByNode.get(neighbor) ?? Number.POSITIVE_INFINITY,
          ),
        );
      } else if (onStack.has(neighbor)) {
        lowLinkByNode.set(
          nodeIndex,
          Math.min(
            lowLinkByNode.get(nodeIndex) ?? Number.POSITIVE_INFINITY,
            indexByNode.get(neighbor) ?? Number.POSITIVE_INFINITY,
          ),
        );
      }
    }

    if (lowLinkByNode.get(nodeIndex) !== indexByNode.get(nodeIndex)) {
      return;
    }

    const component: number[] = [];
    while (stack.length > 0) {
      const stackNode = stack.pop() as number;
      onStack.delete(stackNode);
      component.push(stackNode);
      if (stackNode === nodeIndex) {
        break;
      }
    }
    components.push(component);
  };

  const nodes = [...activeNodeIndices].sort((left, right) => left - right);
  for (const nodeIndex of nodes) {
    if (!indexByNode.has(nodeIndex)) {
      visit(nodeIndex);
    }
  }

  return components;
};

export const topoSort = (
  nodes: StatementNode[],
  edges: Map<number, Set<number>>,
): TopoSortResult => {
  const indegree: number[] = Array.from({ length: nodes.length }, () => 0);
  for (const toIndices of edges.values()) {
    for (const toIndex of toIndices) {
      if (toIndex < 0 || toIndex >= indegree.length) {
        continue;
      }
      indegree[toIndex] = (indegree[toIndex] ?? 0) + 1;
    }
  }

  const queue: number[] = [];
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    if ((indegree[nodeIndex] ?? 0) === 0) {
      queue.push(nodeIndex);
    }
  }
  queue.sort((left, right) => compareStatementIndices(left, right, nodes));

  const orderedIndices: number[] = [];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    orderedIndices.push(current);

    const neighbors = [...(edges.get(current) ?? new Set<number>())];
    neighbors.sort((left, right) =>
      compareStatementIndices(left, right, nodes),
    );
    for (const next of neighbors) {
      if (next < 0 || next >= indegree.length) {
        continue;
      }
      indegree[next] = (indegree[next] ?? 0) - 1;
      if ((indegree[next] ?? 0) === 0) {
        insertSorted(queue, next, nodes);
      }
    }
  }

  if (orderedIndices.length === nodes.length) {
    return { orderedIndices, cycleGroups: [] };
  }

  const cycleNodeIndices = new Set<number>();
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    if ((indegree[nodeIndex] ?? 0) > 0) {
      cycleNodeIndices.add(nodeIndex);
    }
  }

  const components = stronglyConnectedComponents(edges, cycleNodeIndices);
  const cycleGroups = components
    .filter((component) => {
      if (component.length > 1) {
        return true;
      }
      const only = component[0];
      if (typeof only !== "number") {
        return false;
      }
      return (edges.get(only) ?? new Set<number>()).has(only);
    })
    .map((component) =>
      [...component].sort((left, right) =>
        compareStatementIndices(left, right, nodes),
      ),
    );

  cycleGroups.sort((left, right) => {
    if (left.length === 0 || right.length === 0) {
      return left.length - right.length;
    }
    const leftHead = left[0];
    const rightHead = right[0];
    if (typeof leftHead !== "number" || typeof rightHead !== "number") {
      return left.length - right.length;
    }
    return compareStatementIndices(leftHead, rightHead, nodes);
  });

  return { orderedIndices, cycleGroups };
};
