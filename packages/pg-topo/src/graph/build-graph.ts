import {
  isKindCompatible,
  signaturesCompatible,
} from "../model/object-compat.ts";
import { isBuiltInObjectRef, objectRefKey } from "../model/object-ref.ts";
import type {
  Diagnostic,
  GraphEdgeReason,
  ObjectRef,
  StatementNode,
} from "../model/types.ts";

export type EdgeMetadata = {
  reason: GraphEdgeReason;
  objectRef?: ObjectRef;
};

export type GraphState = {
  edges: Map<number, Set<number>>;
  edgeMetadata: Map<string, EdgeMetadata>;
  producersByKey: Map<string, number[]>;
  diagnostics: Diagnostic[];
};

const edgeKey = (fromIndex: number, toIndex: number): string =>
  `${fromIndex}->${toIndex}`;

const addEdge = (
  graphState: GraphState,
  fromIndex: number,
  toIndex: number,
  metadata: EdgeMetadata,
): void => {
  const adjacency = graphState.edges.get(fromIndex) ?? new Set<number>();
  adjacency.add(toIndex);
  graphState.edges.set(fromIndex, adjacency);
  graphState.edgeMetadata.set(edgeKey(fromIndex, toIndex), metadata);
};

const candidateObjectKeysForRequirement = (
  requiredRef: ObjectRef,
  nodes: StatementNode[],
  mode: "compatible" | "similar_name",
): string[] => {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    for (const providedRef of node.provides) {
      if (!isKindCompatible(requiredRef.kind, providedRef.kind)) {
        continue;
      }
      if (providedRef.name !== requiredRef.name) {
        continue;
      }
      if (
        mode === "compatible" &&
        requiredRef.schema &&
        providedRef.schema !== requiredRef.schema
      ) {
        continue;
      }
      keys.add(objectRefKey(providedRef));
    }
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
};

const producerIndicesForRequirement = (
  requiredRef: ObjectRef,
  nodes: StatementNode[],
): number[] => {
  const indices: number[] = [];
  for (
    let producerIndex = 0;
    producerIndex < nodes.length;
    producerIndex += 1
  ) {
    const node = nodes[producerIndex];
    if (!node) {
      continue;
    }

    const hasMatchingProvide = node.provides.some((providedRef) => {
      if (!isKindCompatible(requiredRef.kind, providedRef.kind)) {
        return false;
      }
      if (providedRef.name !== requiredRef.name) {
        return false;
      }
      if (requiredRef.schema && providedRef.schema !== requiredRef.schema) {
        return false;
      }
      if (!signaturesCompatible(requiredRef.signature, providedRef.signature)) {
        return false;
      }
      return true;
    });

    if (hasMatchingProvide) {
      indices.push(producerIndex);
    }
  }
  return indices;
};

export const buildGraph = (nodes: StatementNode[]): GraphState => {
  const diagnostics: Diagnostic[] = [];
  const producersByKey = new Map<string, number[]>();
  const edges = new Map<number, Set<number>>();
  const edgeMetadata = new Map<string, EdgeMetadata>();
  const graphState: GraphState = {
    edges,
    edgeMetadata,
    producersByKey,
    diagnostics,
  };

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) {
      continue;
    }
    for (const providedRef of node.provides) {
      const key = objectRefKey(providedRef);
      const producerIndices = producersByKey.get(key) ?? [];
      producerIndices.push(index);
      producersByKey.set(key, producerIndices);
    }
  }

  for (const [producerKey, producerIndices] of producersByKey.entries()) {
    if (producerIndices.length < 2) {
      continue;
    }
    const firstProducerIndex = producerIndices[0];
    const firstProducer =
      typeof firstProducerIndex === "number"
        ? nodes[firstProducerIndex]
        : undefined;
    const sampleRef = firstProducer?.provides.find(
      (providedRef: ObjectRef) => objectRefKey(providedRef) === producerKey,
    );
    for (const duplicateIndex of producerIndices) {
      const duplicateNode = nodes[duplicateIndex];
      if (!duplicateNode) {
        continue;
      }
      diagnostics.push({
        code: "DUPLICATE_PRODUCER",
        message: `Multiple statements provide '${producerKey}'.`,
        objectRefs: sampleRef ? [sampleRef] : undefined,
        statementId: duplicateNode.id,
      });
    }
  }

  for (
    let consumerIndex = 0;
    consumerIndex < nodes.length;
    consumerIndex += 1
  ) {
    const consumer = nodes[consumerIndex];
    if (!consumer) {
      continue;
    }
    for (const requiredRef of consumer.requires) {
      if (isBuiltInObjectRef(requiredRef)) {
        continue;
      }

      const requiredKey = objectRefKey(requiredRef);
      const producerIndices = producersByKey.get(requiredKey) ?? [];

      if (producerIndices.length === 1) {
        const producerIndex = producerIndices[0];
        if (
          typeof producerIndex === "number" &&
          producerIndex !== consumerIndex
        ) {
          addEdge(graphState, producerIndex, consumerIndex, {
            reason: "requires",
            objectRef: requiredRef,
          });
        }
        continue;
      }

      if (producerIndices.length > 1) {
        if (requiredRef.kind === "constraint") {
          const uniqueProducerIndices = [...new Set(producerIndices)].filter(
            (producerIndex) => producerIndex !== consumerIndex,
          );
          for (const producerIndex of uniqueProducerIndices) {
            addEdge(graphState, producerIndex, consumerIndex, {
              reason: "requires_constraint_key",
              objectRef: requiredRef,
            });
          }
          continue;
        }

        const candidateObjectKeys = candidateObjectKeysForRequirement(
          requiredRef,
          nodes,
          "compatible",
        );
        diagnostics.push({
          code: "DUPLICATE_PRODUCER",
          message: `Ambiguous dependency '${requiredKey}' has multiple producers.`,
          statementId: consumer.id,
          objectRefs: [requiredRef],
          suggestedFix:
            "Use pg-topo:requires with an explicit signature or schema-qualified object to disambiguate.",
          details: {
            requiredObjectKey: requiredKey,
            candidateObjectKeys,
          },
        });
        continue;
      }

      const compatibleProducerIndices = producerIndicesForRequirement(
        requiredRef,
        nodes,
      ).filter((index) => index !== consumerIndex);
      if (compatibleProducerIndices.length === 1) {
        const producerIndex = compatibleProducerIndices[0];
        if (typeof producerIndex !== "number") {
          continue;
        }
        addEdge(graphState, producerIndex, consumerIndex, {
          reason: "requires_compatible",
          objectRef: requiredRef,
        });
        continue;
      }

      if (compatibleProducerIndices.length > 1) {
        const candidateObjectKeys = candidateObjectKeysForRequirement(
          requiredRef,
          nodes,
          "compatible",
        );
        diagnostics.push({
          code: "DUPLICATE_PRODUCER",
          message: `Ambiguous compatible producers found for '${requiredKey}'.`,
          statementId: consumer.id,
          objectRefs: [requiredRef],
          suggestedFix:
            "Add an explicit pg-topo:requires annotation with a more specific signature/schema.",
          details: {
            requiredObjectKey: requiredKey,
            candidateObjectKeys,
          },
        });
        continue;
      }

      const candidateObjectKeys = candidateObjectKeysForRequirement(
        requiredRef,
        nodes,
        "similar_name",
      );
      const suggestedFix =
        candidateObjectKeys.length > 0
          ? "A similarly named object exists in a different schema or signature; qualify it explicitly or add a pg-topo:requires annotation."
          : "Add the missing statement to your SQL set or declare an explicit pg-topo annotation.";

      diagnostics.push({
        code: "UNRESOLVED_DEPENDENCY",
        message: `No producer found for '${requiredKey}'.`,
        statementId: consumer.id,
        objectRefs: [requiredRef],
        suggestedFix,
        details: {
          requiredObjectKey: requiredKey,
          candidateObjectKeys,
        },
      });
    }
  }

  return graphState;
};
