import {
  formatColumnList,
  formatKeyValueItems,
  formatListItems,
  indentString,
} from "./format-utils.ts";
import { findTopLevelParen, scanTokens, splitByCommas } from "./tokenizer.ts";
import type { NormalizedOptions, Token } from "./types.ts";

export function formatCreateDomain(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 2) return null;
  if (tokens[0].upper !== "CREATE" || tokens[1].upper !== "DOMAIN") {
    return null;
  }

  const clauseStarts: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].depth !== 0) continue;

    const upper = tokens[i].upper;
    if (upper === "COLLATE" || upper === "DEFAULT" || upper === "CHECK") {
      clauseStarts.push(tokens[i].start);
      continue;
    }
    if (
      upper === "NOT" &&
      tokens[i + 1]?.upper === "NULL" &&
      tokens[i + 1]?.depth === 0
    ) {
      clauseStarts.push(tokens[i].start);
      i += 1;
    }
  }

  if (clauseStarts.length === 0) return null;
  clauseStarts.sort((a, b) => a - b);

  const prefix = statement.slice(0, clauseStarts[0]).trim();
  const clauses: string[] = [];
  for (let i = 0; i < clauseStarts.length; i += 1) {
    const start = clauseStarts[i];
    const end = clauseStarts[i + 1] ?? statement.length;
    const clause = statement.slice(start, end).trim();
    if (clause.length > 0) clauses.push(clause);
  }

  const indent = indentString(options.indent);
  return [prefix, ...clauses.map((clause) => `${indent}${clause}`)].join("\n");
}

export function formatCreateEnum(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 4) return null;
  if (tokens[0].upper !== "CREATE" || tokens[1].upper !== "TYPE") {
    return null;
  }

  const enumToken = tokens.find(
    (token, index) =>
      token.upper === "ENUM" && tokens[index - 1]?.upper === "AS",
  );
  if (!enumToken) return null;

  const parens = findTopLevelParen(statement, enumToken.end);
  if (!parens) return null;
  const { open, close } = parens;

  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const items = splitByCommas(content);
  const indent = indentString(options.indent);
  const listLines = formatListItems(items, indent, options.commaStyle);

  const lines = [`${header} (`, ...listLines, `)${suffix ? ` ${suffix}` : ""}`];
  return lines.join("\n");
}

export function formatCreateCompositeType(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0].upper !== "CREATE" || tokens[1].upper !== "TYPE") {
    return null;
  }

  const asToken = tokens.find((token) => token.upper === "AS");
  if (!asToken) return null;
  const asIndex = tokens.indexOf(asToken);
  const nextToken = tokens[asIndex + 1];
  if (nextToken?.upper === "ENUM" || nextToken?.upper === "RANGE") {
    return null;
  }
  const parens = findTopLevelParen(statement, asToken.end);
  if (!parens) return null;

  const { open, close } = parens;
  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const formattedColumns = formatColumnList(content, options);
  if (!formattedColumns) return null;

  const lines = [
    `${header} (`,
    ...formattedColumns,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateTable(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0].upper !== "CREATE") return null;

  const tableToken = tokens.find((token, index) => {
    if (token.upper !== "TABLE") return false;
    if (index > 0 && tokens[index - 1].upper === "RETURNS") return false;
    return true;
  });
  if (!tableToken) return null;

  const parens = findTopLevelParen(statement, tableToken.end);
  if (!parens) return null;

  const { open, close } = parens;
  const hasPartitionBeforeColumns = tokens.some(
    (token) =>
      token.depth === 0 && token.upper === "PARTITION" && token.start < open,
  );
  if (hasPartitionBeforeColumns) return null;
  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const formattedColumns = formatColumnList(content, options);
  if (!formattedColumns) return null;

  const lines = [
    `${header} (`,
    ...formattedColumns,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateRange(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 4) return null;
  if (tokens[0].upper !== "CREATE" || tokens[1].upper !== "TYPE") {
    return null;
  }

  const rangeToken = tokens.find(
    (token, index) =>
      token.upper === "RANGE" && tokens[index - 1]?.upper === "AS",
  );
  if (!rangeToken) return null;

  const parens = findTopLevelParen(statement, rangeToken.end);
  if (!parens) return null;
  const { open, close } = parens;

  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const items = splitByCommas(content);
  if (items.length === 0) return null;

  const formattedItems = formatKeyValueItems(items, options);
  const lines = [
    `${header} (`,
    ...formattedItems,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateCollation(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0].upper !== "CREATE" || tokens[1].upper !== "COLLATION") {
    return null;
  }

  const parens = findTopLevelParen(statement, tokens[1].end);
  if (!parens) return null;
  const { open, close } = parens;

  const header = statement.slice(0, open).trim();
  const content = statement.slice(open + 1, close).trim();
  const suffix = statement.slice(close + 1).trim();

  const items = splitByCommas(content);
  if (items.length === 0) return null;

  const formattedItems = formatKeyValueItems(items, options);
  const lines = [
    `${header} (`,
    ...formattedItems,
    `)${suffix ? ` ${suffix}` : ""}`,
  ];
  return lines.join("\n");
}

export function formatCreateFunction(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0].upper !== "CREATE") return null;

  let cursor = 1;
  if (
    tokens[cursor]?.upper === "OR" &&
    tokens[cursor + 1]?.upper === "REPLACE"
  ) {
    cursor += 2;
  }
  const objectToken = tokens[cursor];
  if (
    !objectToken ||
    (objectToken.upper !== "FUNCTION" && objectToken.upper !== "PROCEDURE")
  ) {
    return null;
  }

  const parens = findTopLevelParen(statement, objectToken.end);
  if (!parens) return null;
  const { open, close } = parens;

  const header = statement.slice(0, open).trim();
  const argContent = statement.slice(open + 1, close).trim();
  const postArgs = statement.slice(close + 1).trim();

  const indent = indentString(options.indent);
  const lines: string[] = [];

  if (argContent.length === 0) {
    lines.push(`${header}()`);
  } else {
    const formattedArgs = formatColumnList(argContent, options);
    if (formattedArgs) {
      lines.push(`${header} (`, ...formattedArgs, `)`);
    } else {
      lines.push(`${header}(${argContent})`);
    }
  }

  if (postArgs.length === 0) {
    return lines.join("\n");
  }

  const clauseKeywords = new Set([
    "RETURNS",
    "LANGUAGE",
    "TRANSFORM",
    "WINDOW",
    "IMMUTABLE",
    "STABLE",
    "VOLATILE",
    "LEAKPROOF",
    "CALLED",
    "STRICT",
    "SECURITY",
    "PARALLEL",
    "COST",
    "ROWS",
    "SUPPORT",
    "SET",
    "AS",
  ]);

  const postTokens = scanTokens(postArgs);
  const clauseStarts: number[] = [];

  for (let i = 0; i < postTokens.length; i += 1) {
    const tok = postTokens[i];
    if (tok.depth !== 0) continue;

    if (tok.upper === "NOT" && postTokens[i + 1]?.upper === "LEAKPROOF") {
      clauseStarts.push(tok.start);
      i += 1;
      continue;
    }

    if (clauseKeywords.has(tok.upper)) {
      clauseStarts.push(tok.start);
      continue;
    }
    if (tok.value.startsWith("__PGDELTA_PLACEHOLDER_")) {
      clauseStarts.push(tok.start);
    }
  }

  if (clauseStarts.length === 0) {
    lines[lines.length - 1] += ` ${postArgs}`;
    return lines.join("\n");
  }

  clauseStarts.sort((a, b) => a - b);

  const beforeFirstClause = postArgs.slice(0, clauseStarts[0]).trim();
  if (beforeFirstClause.length > 0) {
    lines[lines.length - 1] += ` ${beforeFirstClause}`;
  }

  for (let i = 0; i < clauseStarts.length; i += 1) {
    const start = clauseStarts[i];
    const end = clauseStarts[i + 1] ?? postArgs.length;
    const clause = postArgs.slice(start, end).trim();

    const clauseTokens = scanTokens(clause);
    if (
      clauseTokens.length >= 2 &&
      clauseTokens[0].upper === "RETURNS" &&
      clauseTokens[1].upper === "TABLE"
    ) {
      const tableParens = findTopLevelParen(clause, clauseTokens[1].end);
      if (tableParens) {
        const innerContent = clause
          .slice(tableParens.open + 1, tableParens.close)
          .trim();
        const afterTable = clause.slice(tableParens.close + 1).trim();

        if (innerContent.length > 0) {
          const formattedCols = formatColumnList(innerContent, {
            ...options,
            indent: options.indent * 2,
          });
          if (formattedCols) {
            lines.push(
              `${indent}RETURNS TABLE (`,
              ...formattedCols,
              `${indent})`,
            );
          } else {
            lines.push(`${indent}RETURNS TABLE (${innerContent})`);
          }
        } else {
          lines.push(`${indent}RETURNS TABLE ()`);
        }
        if (afterTable.length > 0) {
          lines[lines.length - 1] += ` ${afterTable}`;
        }
        continue;
      }
    }

    lines.push(`${indent}${clause}`);
  }

  return lines.join("\n");
}

export function formatCreatePolicy(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0].upper !== "CREATE" || tokens[1].upper !== "POLICY") {
    return null;
  }

  const clauseKeywords = new Set(["FOR", "TO", "USING", "WITH"]);

  const clauseStarts: number[] = [];
  for (let i = 2; i < tokens.length; i += 1) {
    if (tokens[i].depth !== 0) continue;
    const upper = tokens[i].upper;

    if (
      upper === "AS" &&
      (tokens[i + 1]?.upper === "PERMISSIVE" ||
        tokens[i + 1]?.upper === "RESTRICTIVE")
    ) {
      clauseStarts.push(tokens[i].start);
      continue;
    }
    if (upper === "WITH" && tokens[i + 1]?.upper === "CHECK") {
      clauseStarts.push(tokens[i].start);
      continue;
    }
    if (upper === "WITH") continue;
    if (clauseKeywords.has(upper)) {
      clauseStarts.push(tokens[i].start);
    }
  }

  if (clauseStarts.length === 0) return null;
  clauseStarts.sort((a, b) => a - b);

  const header = statement.slice(0, clauseStarts[0]).trim();
  const indent = indentString(options.indent);
  const lines = [header];

  for (let i = 0; i < clauseStarts.length; i += 1) {
    const start = clauseStarts[i];
    const end = clauseStarts[i + 1] ?? statement.length;
    const clause = statement.slice(start, end).trim();
    if (clause.length > 0) lines.push(`${indent}${clause}`);
  }

  return lines.join("\n");
}

export function formatCreateTrigger(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0].upper !== "CREATE") return null;

  let triggerIndex = -1;
  for (let i = 1; i < Math.min(5, tokens.length); i += 1) {
    if (tokens[i].upper === "TRIGGER") {
      triggerIndex = i;
      break;
    }
  }
  if (triggerIndex === -1) return null;

  const nameToken = tokens[triggerIndex + 1];
  if (!nameToken) return null;

  const headerEnd = nameToken.end;
  const rest = statement.slice(headerEnd).trim();
  const header = statement.slice(0, headerEnd).trim();

  if (rest.length === 0) return null;

  const clauseKeywords = new Set([
    "BEFORE",
    "AFTER",
    "INSTEAD",
    "FOR",
    "WHEN",
    "EXECUTE",
  ]);
  const restTokens = scanTokens(rest);
  const clauseStarts: number[] = [];

  for (let i = 0; i < restTokens.length; i += 1) {
    if (restTokens[i].depth !== 0) continue;
    if (clauseKeywords.has(restTokens[i].upper)) {
      clauseStarts.push(restTokens[i].start);
    }
  }

  if (clauseStarts.length === 0) return null;
  clauseStarts.sort((a, b) => a - b);

  const indent = indentString(options.indent);
  const lines = [header];

  for (let i = 0; i < clauseStarts.length; i += 1) {
    const start = clauseStarts[i];
    const end = clauseStarts[i + 1] ?? rest.length;
    const clause = rest.slice(start, end).trim();
    if (clause.length > 0) lines.push(`${indent}${clause}`);
  }

  return lines.join("\n");
}

export function formatCreateIndex(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0].upper !== "CREATE") return null;

  let indexIndex = -1;
  for (let i = 1; i < Math.min(4, tokens.length); i += 1) {
    if (tokens[i].upper === "INDEX") {
      indexIndex = i;
      break;
    }
  }
  if (indexIndex === -1) return null;

  const parens = findTopLevelParen(statement, tokens[indexIndex].end);
  if (!parens) return null;

  let headerEnd = parens.close + 1;

  const afterParens = statement.slice(headerEnd).trim();
  const afterTokens = scanTokens(afterParens);
  if (afterTokens.length > 0 && afterTokens[0].upper === "INCLUDE") {
    const includeParens = findTopLevelParen(afterParens, afterTokens[0].end);
    if (includeParens) {
      headerEnd =
        headerEnd + afterParens.slice(0, includeParens.close + 1).length;
    }
  }

  const restText = statement.slice(headerEnd).trim();
  if (restText.length === 0) return null;

  const clauseKeywords = new Set(["WHERE", "WITH", "TABLESPACE"]);
  const restTokens = scanTokens(restText);
  const clauseStarts: number[] = [];

  for (let i = 0; i < restTokens.length; i += 1) {
    if (restTokens[i].depth !== 0) continue;
    if (clauseKeywords.has(restTokens[i].upper)) {
      clauseStarts.push(restTokens[i].start);
    }
  }

  if (clauseStarts.length === 0) return null;
  clauseStarts.sort((a, b) => a - b);

  const header = statement.slice(0, headerEnd).trim();
  const indent = indentString(options.indent);
  const lines = [header];

  for (let i = 0; i < clauseStarts.length; i += 1) {
    const start = clauseStarts[i];
    const end = clauseStarts[i + 1] ?? restText.length;
    const clause = restText.slice(start, end).trim();
    if (clause.length > 0) lines.push(`${indent}${clause}`);
  }

  return lines.join("\n");
}

export function formatAlterTable(
  statement: string,
  tokens: Token[],
  options: NormalizedOptions,
): string | null {
  if (tokens.length < 3) return null;
  if (tokens[0].upper !== "ALTER" || tokens[1].upper !== "TABLE") {
    return null;
  }

  let cursor = 2;
  if (
    tokens[cursor]?.upper === "IF" &&
    tokens[cursor + 1]?.upper === "EXISTS"
  ) {
    cursor += 2;
  }
  if (tokens[cursor]?.upper === "ONLY") {
    cursor += 1;
  }

  const nameStart = cursor;
  if (nameStart >= tokens.length) return null;

  cursor += 1;
  while (
    cursor < tokens.length &&
    tokens[cursor].start === tokens[cursor - 1].end + 1 &&
    statement[tokens[cursor - 1].end] === "."
  ) {
    cursor += 1;
  }

  if (cursor >= tokens.length) return null;

  const headerEnd = tokens[cursor].start;
  const header = statement.slice(0, headerEnd).trim();
  const action = statement.slice(headerEnd).trim();

  if (action.length === 0) return null;

  const indent = indentString(options.indent);
  return `${header}\n${indent}${action}`;
}

export function formatGeneric(
  statement: string,
  _tokens: Token[],
  _options: NormalizedOptions,
): string {
  return statement.trim();
}
