import { Effect, ManagedRuntime } from "effect";
import { deparseSql, parseSql } from "plpgsql-parser";
import { parseAnnotations } from "../annotations/parse-annotations.ts";
import type {
  AnnotationHints,
  Diagnostic,
  StatementId,
} from "../model/types.ts";
import { ParserService } from "../services/parser.ts";
import { ParserServiceLive } from "../services/parser-live.ts";

type RawParserStatement = {
  stmt?: unknown;
  stmt_location?: number;
  stmt_len?: number;
};

type RawParserResult = {
  stmts?: RawParserStatement[];
};

export type ParsedStatement = {
  id: StatementId;
  ast: unknown;
  sql: string;
  annotations: AnnotationHints;
};

type ParseContentResult = {
  statements: ParsedStatement[];
  diagnostics: Diagnostic[];
};

const ensureStatementTerminator = (sql: string): string =>
  sql.trimEnd().endsWith(";") ? sql.trim() : `${sql.trim()};`;

const extractStatementSql = async (
  fileContent: string,
  statement: RawParserStatement,
): Promise<string> => {
  const location = statement.stmt_location ?? 0;
  const length = statement.stmt_len ?? 0;
  if (
    Number.isInteger(location) &&
    Number.isInteger(length) &&
    location >= 0 &&
    length > 0 &&
    location + length <= fileContent.length
  ) {
    const sliced = fileContent.slice(location, location + length).trim();
    if (sliced.length > 0) {
      const candidate = ensureStatementTerminator(sliced);
      try {
        const parsed = parseSql(candidate) as RawParserResult;
        if ((parsed.stmts ?? []).length > 0) {
          return candidate;
        }
      } catch {
        // Fallback to deparse below when stmt_location slice is not executable.
      }
    }
  }

  if (statement.stmt) {
    const deparsed = await deparseSql(statement.stmt as object);
    return ensureStatementTerminator(deparsed);
  }

  return "";
};

/**
 * Core implementation — assumes the parser WASM module is already loaded.
 * Used by `ParserServiceLive` which handles module loading via `Effect.once`.
 */
export const parseSqlContentImpl = async (
  content: string,
  sourceLabel: string,
): Promise<ParseContentResult> => {
  const diagnostics: Diagnostic[] = [];

  let parseResult: RawParserResult;
  try {
    parseResult = parseSql(content) as RawParserResult;
  } catch (error) {
    diagnostics.push({
      code: "PARSE_ERROR",
      message: error instanceof Error ? error.message : "Unknown parser error.",
      statementId: {
        filePath: sourceLabel,
        statementIndex: 0,
      },
    });
    return { statements: [], diagnostics };
  }

  const statements: ParsedStatement[] = [];
  const parserStatements = parseResult.stmts ?? [];

  for (let index = 0; index < parserStatements.length; index += 1) {
    const statement = parserStatements[index];
    if (!statement?.stmt) {
      diagnostics.push({
        code: "PARSE_ERROR",
        message: "Parser returned an empty statement node.",
        statementId: {
          filePath: sourceLabel,
          statementIndex: index,
        },
      });
      continue;
    }

    const sql = await extractStatementSql(content, statement);
    const annotationResult = parseAnnotations(sql);

    // Advance past leading whitespace so sourceOffset points to the first character
    // of the statement (e.g. "CREATE"); statement IDs and diagnostics then refer to
    // the real start of the statement for display and editor jump-to.
    let sourceOffset = statement.stmt_location ?? 0;
    while (
      sourceOffset < content.length &&
      /\s/.test(content[sourceOffset] ?? "")
    ) {
      sourceOffset += 1;
    }
    statements.push({
      id: {
        filePath: sourceLabel,
        statementIndex: index,
        sourceOffset,
      },
      ast: statement.stmt,
      sql,
      annotations: annotationResult.annotations,
    });

    for (const diagnostic of annotationResult.diagnostics) {
      diagnostics.push({
        ...diagnostic,
        statementId: {
          filePath: sourceLabel,
          statementIndex: index,
          sourceOffset,
        },
      });
    }
  }

  return { statements, diagnostics };
};

/**
 * Module-level managed runtime — lazily builds ParserServiceLive on first use
 * and reuses it for all subsequent calls. WASM loading happens exactly once
 * through Effect.once inside ParserServiceLive.
 */
const parserRuntime = ManagedRuntime.make(ParserServiceLive);

/**
 * Backward-compatible wrapper that routes through ParserService.
 * New code should use `ParserService` from `../services/parser.ts` directly.
 */
export const parseSqlContent = async (
  content: string,
  sourceLabel: string,
): Promise<ParseContentResult> => {
  return parserRuntime.runPromise(
    Effect.gen(function* () {
      const parser = yield* ParserService;
      return yield* parser.parseSqlContent(content, sourceLabel);
    }),
  );
};
