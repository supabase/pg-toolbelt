import type { ObjectRef } from "../model/types.ts";
import type { ParserApi } from "../services/parser.ts";

export const addExpressionDependencies = (
  parser: Pick<ParserApi, "collectExpressionDependencies">,
  expressionNode: unknown,
  requires: ObjectRef[],
): void => {
  requires.push(...parser.collectExpressionDependencies(expressionNode));
};

export const addRoutineBodyDependencies = (
  parser: Pick<ParserApi, "collectRoutineBodyDependencies">,
  statementNode: Record<string, unknown>,
  requires: ObjectRef[],
): void => {
  requires.push(...parser.collectRoutineBodyDependencies(statementNode));
};
