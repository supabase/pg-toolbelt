import type { GraphState } from "../../../src/graph/build-graph";
import { topoSort } from "../../../src/graph/topo-sort";
import { objectRefKey } from "../../../src/model/object-ref";
import type { StatementNode } from "../../../src/model/types";
import { withPostgresValidationDatabase } from "./postgres-container";
import {
  isDependencyErrorCode,
  isEnvironmentCapabilityError,
  toDatabaseLikeError,
} from "./postgres-errors";
import {
  findProducerCandidates,
  inferMissingObjectRef,
} from "./postgres-missing-ref";
import type { RuntimeDiagnostic } from "./postgres-types";

type ValidationResult = {
  orderedIndices: number[];
  cycleGroups: number[][];
  diagnostics: RuntimeDiagnostic[];
};

type PostgresValidatorOptions = {
  initialMigrationSql?: string;
};

export const validateWithPostgres = async (
  nodes: StatementNode[],
  graphState: GraphState,
  options: PostgresValidatorOptions = {},
): Promise<ValidationResult> => {
  const { initialMigrationSql } = options;
  const diagnostics: RuntimeDiagnostic[] = [];
  const topoResult = topoSort(nodes, graphState.edges);
  if (topoResult.cycleGroups.length > 0) {
    return {
      orderedIndices: topoResult.orderedIndices,
      cycleGroups: topoResult.cycleGroups,
      diagnostics,
    };
  }

  const orderPositionByIndex = new Map<number, number>();
  topoResult.orderedIndices.forEach((nodeIndex, orderPosition) => {
    orderPositionByIndex.set(nodeIndex, orderPosition);
  });
  let aborted = false;

  await withPostgresValidationDatabase(
    async (db) => {
      await db.query("set check_function_bodies = off");

      for (const statementIndex of topoResult.orderedIndices) {
        if (aborted) {
          break;
        }

        const statementNode = nodes[statementIndex];
        if (!statementNode) {
          continue;
        }
        try {
          await db.query(statementNode.sql);
        } catch (error) {
          const dbError = toDatabaseLikeError(error);

          if (isEnvironmentCapabilityError(dbError, statementNode)) {
            diagnostics.push({
              code: "RUNTIME_ENVIRONMENT_LIMITATION",
              message:
                dbError.message ??
                "Statement depends on capabilities not available in local Postgres validation.",
              statementId: statementNode.id,
              details: {
                sqlstate: dbError.code,
                statementClass: statementNode.statementClass,
              },
              suggestedFix:
                "This is expected in local validation when extension/runtime capabilities differ from target Postgres.",
            });
            continue;
          }

          if (!isDependencyErrorCode(dbError.code)) {
            diagnostics.push({
              code: "RUNTIME_EXECUTION_ERROR",
              message: dbError.message ?? "Statement execution failed.",
              statementId: statementNode.id,
              details: { sqlstate: dbError.code },
            });
            aborted = true;
            break;
          }

          const missingRef = inferMissingObjectRef(dbError, statementNode);
          if (!missingRef) {
            diagnostics.push({
              code: "RUNTIME_ENVIRONMENT_LIMITATION",
              message:
                dbError.message ??
                "Dependency-like SQLSTATE received, but missing object could not be inferred.",
              statementId: statementNode.id,
              details: {
                sqlstate: dbError.code,
                statementClass: statementNode.statementClass,
              },
            });
            continue;
          }

          const producerCandidates = findProducerCandidates(
            missingRef,
            nodes,
          ).filter((producerIndex) => producerIndex !== statementIndex);
          const uniqueCandidates = [...new Set(producerCandidates)];

          if (uniqueCandidates.length === 0) {
            diagnostics.push({
              code: "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
              message:
                dbError.message ??
                "Missing dependency has no producer in declarative schema; assuming it exists on target database.",
              statementId: statementNode.id,
              objectRefs: [missingRef],
              suggestedFix:
                "If this object is expected to be created here, add the statement or an explicit pg-topo annotation.",
              details: {
                sqlstate: dbError.code,
                missingObjectKey: objectRefKey(missingRef),
              },
            });
            continue;
          }

          if (uniqueCandidates.length > 1) {
            diagnostics.push({
              code: "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
              message:
                dbError.message ??
                "Missing dependency has multiple possible producers; assuming external or overloaded target object.",
              statementId: statementNode.id,
              objectRefs: [missingRef],
              suggestedFix:
                "Disambiguate with a pg-topo:requires annotation including schema/signature when possible.",
              details: {
                sqlstate: dbError.code,
                candidateCount: uniqueCandidates.length,
                candidateStatementIds: uniqueCandidates
                  .map((index) => nodes[index]?.id)
                  .filter((statementId): statementId is StatementNode["id"] =>
                    Boolean(statementId),
                  )
                  .map(
                    (statementId) =>
                      `${statementId.filePath}:${statementId.statementIndex}`,
                  ),
              },
            });
            continue;
          }

          const producerIndex = uniqueCandidates[0];
          if (typeof producerIndex !== "number") {
            diagnostics.push({
              code: "RUNTIME_EXECUTION_ERROR",
              message:
                "Internal error while selecting an internal producer candidate.",
              statementId: statementNode.id,
              details: { sqlstate: dbError.code },
            });
            aborted = true;
            break;
          }

          const producerOrderPosition = orderPositionByIndex.get(producerIndex);
          const currentOrderPosition = orderPositionByIndex.get(statementIndex);
          if (
            typeof producerOrderPosition === "number" &&
            typeof currentOrderPosition === "number" &&
            producerOrderPosition < currentOrderPosition
          ) {
            diagnostics.push({
              code: "RUNTIME_ASSUMED_EXTERNAL_DEPENDENCY",
              message:
                dbError.message ??
                "Producer candidate already executed but object is still unavailable; assuming external capability/object mismatch.",
              statementId: statementNode.id,
              objectRefs: [missingRef],
              details: {
                sqlstate: dbError.code,
                missingObjectKey: objectRefKey(missingRef),
                producerStatementId: `${nodes[producerIndex]?.id.filePath}:${nodes[producerIndex]?.id.statementIndex}`,
              },
            });
            continue;
          }

          diagnostics.push({
            code: "RUNTIME_EXECUTION_ERROR",
            message:
              dbError.message ??
              "Internal dependency execution failure detected; static ordering missed a required edge.",
            statementId: statementNode.id,
            objectRefs: [missingRef],
            suggestedFix:
              "Update static extraction/compatibility logic or add explicit pg-topo:requires annotation.",
            details: {
              sqlstate: dbError.code,
              missingObjectKey: objectRefKey(missingRef),
              producerStatementId: `${nodes[producerIndex]?.id.filePath}:${nodes[producerIndex]?.id.statementIndex}`,
            },
          });
          aborted = true;
          break;
        }
      }
    },
    { initialMigrationSql },
  );

  return {
    orderedIndices: topoResult.orderedIndices,
    cycleGroups: topoResult.cycleGroups,
    diagnostics,
  };
};
