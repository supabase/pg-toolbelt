import type { Diagnostic, ObjectRef } from "../model/types.ts";
import type { ParserApi } from "../services/parser.ts";

export const addExpressionDependencies = (
  parser: Pick<ParserApi, "collectExpressionDependencies">,
  expressionNode: unknown,
  requires: ObjectRef[],
  diagnostics?: Diagnostic[],
): void => {
  requires.push(
    ...parser.collectExpressionDependencies(
      expressionNode,
      undefined,
      diagnostics,
    ),
  );
};

export const addRoutineBodyDependencies = (
  parser: Pick<ParserApi, "collectRoutineBodyDependencies">,
  statementNode: Record<string, unknown>,
  requires: ObjectRef[],
  diagnostics?: Diagnostic[],
): void => {
  requires.push(
    ...parser.collectRoutineBodyDependencies(statementNode, diagnostics),
  );
};
