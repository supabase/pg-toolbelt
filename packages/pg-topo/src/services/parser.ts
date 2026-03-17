import { type Effect, ServiceMap } from "effect";
import type { ParseError } from "../errors.ts";
import type { ParsedStatement } from "../ingest/parse.ts";
import type { Diagnostic, ObjectRef } from "../model/types.ts";

export interface ParserApi {
  readonly parseSqlContent: (
    sql: string,
    sourceLabel: string,
  ) => Effect.Effect<
    { statements: ParsedStatement[]; diagnostics: Diagnostic[] },
    ParseError
  >;
  readonly collectExpressionDependencies: (
    expressionNode: unknown,
    options?: { qualifiedOnly?: boolean },
    diagnostics?: Diagnostic[],
  ) => ReadonlyArray<ObjectRef>;
  readonly collectRoutineBodyDependencies: (
    statementNode: Record<string, unknown>,
    diagnostics?: Diagnostic[],
  ) => ReadonlyArray<ObjectRef>;
}

export class ParserService extends ServiceMap.Service<
  ParserService,
  ParserApi
>()("@pg-topo/ParserService") {}
