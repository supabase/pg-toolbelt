import { Effect } from "effect";
import type { AnnotationHints, StatementId } from "../model/types.ts";
import { ParserService } from "../services/parser.ts";

export type ParsedStatement = {
  id: StatementId;
  ast: unknown;
  sql: string;
  annotations: AnnotationHints;
};

export const parseSqlContent = Effect.fnUntraced(function* (
  content: string,
  sourceLabel: string,
) {
  const parser = yield* ParserService;
  return yield* parser.parseSqlContent(content, sourceLabel);
});
