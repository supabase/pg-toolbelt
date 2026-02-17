import {
  isKindCompatible,
  signaturesCompatible,
} from "../../../src/model/object-compat";
import {
  normalizeSignature,
  splitQualifiedName,
} from "../../../src/model/object-ref";
import type { ObjectRef, StatementNode } from "../../../src/model/types";
import type { DatabaseLikeError } from "./postgres-types";

const relationKindPriority: ObjectRef["kind"][] = [
  "index",
  "table",
  "view",
  "materialized_view",
  "sequence",
];

const inferMissingRelationKindFromStatement = (
  statementNode: StatementNode | undefined,
  schema: string | undefined,
  name: string,
): ObjectRef["kind"] | undefined => {
  if (!statementNode) {
    return undefined;
  }

  const matches = statementNode.requires.filter((requiredRef) => {
    if (requiredRef.name !== name) {
      return false;
    }
    if (schema && requiredRef.schema !== schema) {
      return false;
    }
    return relationKindPriority.includes(requiredRef.kind);
  });

  if (matches.length === 0) {
    return undefined;
  }

  matches.sort((left, right) => {
    const leftSchemaExact = schema && left.schema === schema ? 0 : 1;
    const rightSchemaExact = schema && right.schema === schema ? 0 : 1;
    if (leftSchemaExact !== rightSchemaExact) {
      return leftSchemaExact - rightSchemaExact;
    }
    const leftPriority = relationKindPriority.indexOf(left.kind);
    const rightPriority = relationKindPriority.indexOf(right.kind);
    return leftPriority - rightPriority;
  });

  return matches[0]?.kind;
};

const relationLikeKindPriorityForTypeLookup: ObjectRef["kind"][] = [
  "table",
  "view",
  "materialized_view",
];

const inferMissingTypeKindFromStatement = (
  statementNode: StatementNode | undefined,
  schema: string | undefined,
  name: string,
): ObjectRef["kind"] | undefined => {
  if (!statementNode) {
    return undefined;
  }

  const matches = statementNode.requires.filter((requiredRef) => {
    if (requiredRef.name !== name) {
      return false;
    }
    if (schema && requiredRef.schema !== schema) {
      return false;
    }
    return relationLikeKindPriorityForTypeLookup.includes(requiredRef.kind);
  });

  if (matches.length === 0) {
    return undefined;
  }

  matches.sort((left, right) => {
    const leftPriority = relationLikeKindPriorityForTypeLookup.indexOf(
      left.kind,
    );
    const rightPriority = relationLikeKindPriorityForTypeLookup.indexOf(
      right.kind,
    );
    return leftPriority - rightPriority;
  });

  return matches[0]?.kind;
};

export const inferMissingObjectRef = (
  error: DatabaseLikeError,
  statementNode?: StatementNode,
): ObjectRef | null => {
  const message = error.message ?? "";
  const code = error.code;

  if (code === "42703") {
    const relationMatch = message.match(/relation\s+"([^"]+)"/u);
    if (!relationMatch) {
      return null;
    }
    const objectName = relationMatch[1];
    if (!objectName) {
      return null;
    }
    const { schema, name } = splitQualifiedName(objectName, "ast");
    const inferredKind =
      inferMissingRelationKindFromStatement(statementNode, schema, name) ??
      "table";
    return {
      kind: inferredKind,
      schema,
      name,
    };
  }

  if (code === "42P01") {
    const relationMatch = message.match(/relation\s+"([^"]+)"/u);
    if (!relationMatch) {
      return null;
    }
    const objectName = relationMatch[1];
    if (!objectName) {
      return null;
    }
    const { schema, name } = splitQualifiedName(objectName, "ast");
    const inferredKind =
      inferMissingRelationKindFromStatement(statementNode, schema, name) ??
      "table";
    return {
      kind: inferredKind,
      schema,
      name,
    };
  }

  if (code === "42704") {
    const typeMatch = message.match(/type\s+"([^"]+)"/u);
    if (typeMatch) {
      const objectName = typeMatch[1];
      if (!objectName) {
        return null;
      }
      const { schema, name } = splitQualifiedName(objectName, "ast");
      const inferredKind =
        inferMissingTypeKindFromStatement(statementNode, schema, name) ??
        "type";
      return {
        kind: inferredKind,
        schema,
        name,
      };
    }

    const roleMatch = message.match(/role\s+"([^"]+)"/u);
    if (roleMatch) {
      const roleName = roleMatch[1];
      if (!roleName) {
        return null;
      }
      return {
        kind: "role",
        name: roleName,
      };
    }
  }

  if (code === "42883") {
    const functionMatch = message.match(/function\s+([^(]+)\(([^)]*)\)/u);
    if (!functionMatch) {
      return null;
    }
    const rawQualifiedName = functionMatch[1];
    if (!rawQualifiedName) {
      return null;
    }
    const qualifiedName = rawQualifiedName.replaceAll('"', "").trim();
    const { schema, name } = splitQualifiedName(qualifiedName, "ast");
    return {
      kind: "function",
      schema,
      name,
      signature: functionMatch[2]?.trim().length
        ? functionMatch[2]?.includes("=>")
          ? `(${functionMatch[2].trim()})`
          : normalizeSignature(`(${functionMatch[2]})`)
        : "()",
    };
  }

  if (code === "3F000") {
    const schemaMatch = message.match(/schema\s+"([^"]+)"/u);
    if (!schemaMatch) {
      return null;
    }
    const schemaName = schemaMatch[1];
    if (!schemaName) {
      return null;
    }
    return {
      kind: "schema",
      name: schemaName,
    };
  }

  return null;
};

export const findProducerCandidates = (
  missingRef: ObjectRef,
  nodes: StatementNode[],
): number[] => {
  const candidates: number[] = [];
  for (
    let producerIndex = 0;
    producerIndex < nodes.length;
    producerIndex += 1
  ) {
    const producer = nodes[producerIndex];
    if (!producer) {
      continue;
    }
    const hasCompatibleProvide = producer.provides.some((providedRef) => {
      if (!isKindCompatible(missingRef.kind, providedRef.kind)) {
        return false;
      }
      if (providedRef.name !== missingRef.name) {
        return false;
      }
      if (missingRef.schema && providedRef.schema !== missingRef.schema) {
        return false;
      }
      if (
        !signaturesCompatible(missingRef.signature, providedRef.signature, {
          allowNamedArgumentsInRequirement: true,
        })
      ) {
        return false;
      }
      return true;
    });
    if (hasCompatibleProvide) {
      candidates.push(producerIndex);
    }
  }
  return candidates;
};
