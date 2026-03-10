import { type Effect, ServiceMap } from "effect";
import type { ParseError } from "../errors.ts";
import type { ParsedStatement } from "../ingest/parse.ts";
import type { Diagnostic } from "../model/types.ts";

export interface ParserApi {
  readonly parseSqlContent: (
    sql: string,
    sourceLabel: string,
  ) => Effect.Effect<
    { statements: ParsedStatement[]; diagnostics: Diagnostic[] },
    ParseError
  >;
}

export class ParserService extends ServiceMap.Service<
  ParserService,
  ParserApi
>()("@pg-topo/ParserService") {}
