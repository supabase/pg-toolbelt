import type { SqlFormatOptions, NormalizedOptions } from "./types.ts";
import { DEFAULT_OPTIONS } from "./constants.ts";
import { splitSqlStatements, splitLeadingComments } from "./format-utils.ts";
import { protectSegments, restorePlaceholders } from "./protect.ts";
import { applyKeywordCase } from "./keyword-case.ts";
import { wrapStatement } from "./wrap.ts";
import { scanTokens } from "./tokenizer.ts";
import {
  formatCreateDomain,
  formatCreateEnum,
  formatCreateCompositeType,
  formatCreateTable,
  formatCreateRange,
  formatCreateCollation,
  formatCreateFunction,
  formatCreatePolicy,
  formatCreateTrigger,
  formatCreateIndex,
  formatAlterTable,
  formatGeneric,
} from "./formatters.ts";

export function formatSqlStatements(
  statements: string[],
  options: SqlFormatOptions = {},
): string[] {
  const resolved = normalizeOptions(options);
  const flattened = flattenStatements(statements);
  return flattened
    .map((statement) => formatStatement(statement, resolved))
    .filter((statement) => statement.length > 0);
}

function normalizeOptions(options: SqlFormatOptions): NormalizedOptions {
  const indent =
    typeof options.indent === "number" && Number.isFinite(options.indent)
      ? Math.max(0, Math.floor(options.indent))
      : DEFAULT_OPTIONS.indent;
  const maxWidth =
    typeof options.maxWidth === "number" && Number.isFinite(options.maxWidth)
      ? Math.max(20, Math.floor(options.maxWidth))
      : DEFAULT_OPTIONS.maxWidth;
  const keywordCase =
    options.keywordCase === "upper" ||
    options.keywordCase === "lower" ||
    options.keywordCase === "preserve"
      ? options.keywordCase
      : DEFAULT_OPTIONS.keywordCase;
  const commaStyle =
    options.commaStyle === "leading" || options.commaStyle === "trailing"
      ? options.commaStyle
      : DEFAULT_OPTIONS.commaStyle;

  return {
    keywordCase,
    indent,
    maxWidth,
    commaStyle,
    alignColumns:
      typeof options.alignColumns === "boolean"
        ? options.alignColumns
        : DEFAULT_OPTIONS.alignColumns,
    alignKeyValues:
      typeof options.alignKeyValues === "boolean"
        ? options.alignKeyValues
        : DEFAULT_OPTIONS.alignKeyValues,
    preserveRoutineBodies:
      typeof options.preserveRoutineBodies === "boolean"
        ? options.preserveRoutineBodies
        : DEFAULT_OPTIONS.preserveRoutineBodies,
    preserveViewBodies:
      typeof options.preserveViewBodies === "boolean"
        ? options.preserveViewBodies
        : DEFAULT_OPTIONS.preserveViewBodies,
    preserveRuleBodies:
      typeof options.preserveRuleBodies === "boolean"
        ? options.preserveRuleBodies
        : DEFAULT_OPTIONS.preserveRuleBodies,
  };
}

function flattenStatements(statements: string[]): string[] {
  const output: string[] = [];
  for (const statement of statements) {
    for (const split of splitSqlStatements(statement)) {
      if (split.trim().length > 0) {
        output.push(split);
      }
    }
  }
  return output;
}

function formatStatement(statement: string, options: NormalizedOptions): string {
  const { commentLines, body } = splitLeadingComments(statement);
  if (body.trim().length === 0) {
    return commentLines.join("\n");
  }

  const protectedSegments = protectSegments(body, options);
  const tokens = scanTokens(protectedSegments.text);
  let formatted =
    formatCreateDomain(protectedSegments.text, tokens, options) ??
    formatCreateEnum(protectedSegments.text, tokens, options) ??
    formatCreateCompositeType(protectedSegments.text, tokens, options) ??
    formatCreateTable(protectedSegments.text, tokens, options) ??
    formatCreateRange(protectedSegments.text, tokens, options) ??
    formatCreateCollation(protectedSegments.text, tokens, options) ??
    formatCreateFunction(protectedSegments.text, tokens, options) ??
    formatCreatePolicy(protectedSegments.text, tokens, options) ??
    formatCreateTrigger(protectedSegments.text, tokens, options) ??
    formatCreateIndex(protectedSegments.text, tokens, options) ??
    formatAlterTable(protectedSegments.text, tokens, options) ??
    formatGeneric(protectedSegments.text, tokens, options);

  if (options.keywordCase !== "preserve") {
    formatted = applyKeywordCase(formatted, options);
  }

  formatted = wrapStatement(formatted, options, protectedSegments.noWrapPlaceholders);
  formatted = restorePlaceholders(formatted, protectedSegments.placeholders);

  if (commentLines.length > 0) {
    return [...commentLines, formatted].join("\n");
  }

  return formatted;
}
