import { KEYWORDS } from "./constants.ts";
import { parseDefinitionItem } from "./format-utils.ts";
import { isWordChar, walkSql } from "./sql-scanner.ts";
import { findTopLevelParen, scanTokens, skipQualifiedName } from "./tokenizer.ts";
import type { NormalizedOptions } from "./types.ts";

type Range = { start: number; end: number };

const OPTION_LIST_KEYWORDS = new Set(["WITH", "SET", "OPTIONS", "RESET"]);
const ALTER_TYPE_BOUNDARY_KEYWORDS = new Set([
  "COLLATE",
  "USING",
  "SET",
  "RESET",
  "DROP",
]);

export function applyKeywordCase(
  statement: string,
  options: NormalizedOptions,
): string {
  const transform =
    options.keywordCase === "upper"
      ? (value: string) => value.toUpperCase()
      : (value: string) => value.toLowerCase();
  const protectedRanges = collectProtectedRanges(statement);

  let output = "";
  let skipUntil = -1;
  let rangeIndex = 0;

  walkSql(
    statement,
    (index, char) => {
      if (index < skipUntil) return true;
      while (
        rangeIndex < protectedRanges.length &&
        protectedRanges[rangeIndex].end <= index
      ) {
        rangeIndex += 1;
      }
      if (isWordChar(char)) {
        let end = index + 1;
        while (end < statement.length && isWordChar(statement[end])) {
          end += 1;
        }
        const word = statement.slice(index, end);
        const upper = word.toUpperCase();
        const range = protectedRanges[rangeIndex];
        const isProtected =
          range !== undefined && range.start < end && index < range.end;
        output += isProtected
          ? word
          : KEYWORDS.has(upper)
            ? transform(word)
            : word;
        skipUntil = end;
        return true;
      }
      output += char;
      return true;
    },
    {
      onSkipped: (chunk) => {
        output += chunk;
      },
    },
  );

  return output;
}

function collectProtectedRanges(statement: string): Range[] {
  const tokens = scanTokens(statement);
  if (tokens.length === 0) return [];

  const ranges: Range[] = [];
  collectCheckClauseRanges(statement, tokens, ranges);
  collectOptionAssignmentRanges(statement, tokens, ranges);
  collectDefinitionRanges(statement, tokens, ranges);
  return mergeRanges(ranges);
}

function collectCheckClauseRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.depth !== 0 || token.upper !== "CHECK") continue;

    const open = findImmediateParen(statement, token.end);
    if (open < 0) continue;

    const close = findMatchingParen(statement, open);
    if (close < 0) continue;

    let end = close + 1;
    const nextIndex = findTopLevelTokenAtOrAfter(tokens, end, i + 1);
    const noToken = nextIndex >= 0 ? tokens[nextIndex] : undefined;
    const inheritToken = nextIndex >= 0 ? tokens[nextIndex + 1] : undefined;
    if (
      noToken?.depth === 0 &&
      noToken.upper === "NO" &&
      inheritToken?.depth === 0 &&
      inheritToken.upper === "INHERIT"
    ) {
      end = inheritToken.end;
    }

    ranges.push({ start: token.start, end });
  }
}

function collectOptionAssignmentRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  for (const token of tokens) {
    if (token.depth !== 0 || !OPTION_LIST_KEYWORDS.has(token.upper)) continue;
    const open = findImmediateParen(statement, token.end);
    if (open < 0) continue;
    const close = findMatchingParen(statement, open);
    if (close < 0) continue;
    collectAssignmentItemRanges(statement, open, close, ranges);
  }

  collectCreateOptionBlockAssignmentRanges(statement, tokens, ranges);
}

function collectCreateOptionBlockAssignmentRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  if (tokens[0]?.upper !== "CREATE") return;

  if (tokens[1]?.upper === "COLLATION") {
    const parens = findTopLevelParen(statement, tokens[1].end);
    if (parens) {
      collectAssignmentItemRanges(statement, parens.open, parens.close, ranges);
    }
    return;
  }

  if (tokens[1]?.upper === "TYPE") {
    for (let i = 2; i < tokens.length; i += 1) {
      if (tokens[i].depth !== 0 || tokens[i].upper !== "AS") continue;
      if (tokens[i + 1]?.depth !== 0 || tokens[i + 1]?.upper !== "RANGE") {
        continue;
      }
      const parens = findTopLevelParen(statement, tokens[i + 1].end);
      if (parens) {
        collectAssignmentItemRanges(
          statement,
          parens.open,
          parens.close,
          ranges,
        );
      }
      return;
    }
    return;
  }

  if (tokens[1]?.upper === "AGGREGATE") {
    const argParens = findTopLevelParen(statement, tokens[1].end);
    if (!argParens) return;
    const optParens = findTopLevelParen(statement, argParens.close + 1);
    if (!optParens) return;
    collectAssignmentItemRanges(statement, optParens.open, optParens.close, ranges);
  }
}

function collectAssignmentItemRanges(
  statement: string,
  open: number,
  close: number,
  ranges: Range[],
): void {
  const content = statement.slice(open + 1, close);
  const items = splitTopLevelCommaItems(content, open + 1);
  for (const item of items) {
    const equalsIndex = findTopLevelEquals(item.text);
    if (equalsIndex < 0) continue;

    const key = item.text.slice(0, equalsIndex).trim();
    const value = item.text.slice(equalsIndex + 1).trim();
    if (key.length === 0 || value.length === 0) continue;

    ranges.push({ start: item.start, end: item.end });
  }
}

function collectDefinitionRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  collectCreateDefinitionRanges(statement, tokens, ranges);
  collectAlterDefinitionRanges(statement, tokens, ranges);
}

function collectCreateDefinitionRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  if (tokens[0]?.upper !== "CREATE") return;

  const tableToken = tokens.find((token, index) => {
    if (token.depth !== 0 || token.upper !== "TABLE") return false;
    return tokens[index - 1]?.upper !== "RETURNS";
  });
  if (tableToken) {
    const parens = findTopLevelParen(statement, tableToken.end);
    if (parens) {
      const hasPartitionBeforeColumns = tokens.some(
        (token) =>
          token.depth === 0 &&
          token.upper === "PARTITION" &&
          token.start < parens.open,
      );
      if (!hasPartitionBeforeColumns) {
        collectDefinitionRangesFromParen(statement, parens.open, parens.close, ranges);
      }
    }
  }

  if (tokens[1]?.upper === "TYPE") {
    const asIndex = tokens.findIndex(
      (token, index) =>
        token.depth === 0 &&
        token.upper === "AS" &&
        tokens[index + 1]?.depth === 0 &&
        tokens[index + 1]?.upper !== "ENUM" &&
        tokens[index + 1]?.upper !== "RANGE",
    );
    if (asIndex !== -1) {
      const parens = findTopLevelParen(statement, tokens[asIndex].end);
      if (parens) {
        collectDefinitionRangesFromParen(statement, parens.open, parens.close, ranges);
      }
    }
  }

  let objectIndex = 1;
  if (tokens[1]?.upper === "OR" && tokens[2]?.upper === "REPLACE") {
    objectIndex = 3;
  }
  const objectToken = tokens[objectIndex];
  if (objectToken?.upper === "FUNCTION" || objectToken?.upper === "PROCEDURE") {
    const argParens = findTopLevelParen(statement, objectToken.end);
    if (argParens) {
      collectDefinitionRangesFromParen(
        statement,
        argParens.open,
        argParens.close,
        ranges,
      );
    }
  }

  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (
      tokens[i].depth === 0 &&
      tokens[i].upper === "RETURNS" &&
      tokens[i + 1].depth === 0 &&
      tokens[i + 1].upper === "TABLE"
    ) {
      const parens = findTopLevelParen(statement, tokens[i + 1].end);
      if (parens) {
        collectDefinitionRangesFromParen(statement, parens.open, parens.close, ranges);
      }
    }
  }
}

function collectAlterDefinitionRanges(
  statement: string,
  tokens: ReturnType<typeof scanTokens>,
  ranges: Range[],
): void {
  if (tokens[0]?.upper !== "ALTER") return;

  let cursor = 1;
  if (tokens[cursor]?.upper === "TABLE") {
    cursor += 1;
  } else if (
    tokens[cursor]?.upper === "FOREIGN" &&
    tokens[cursor + 1]?.upper === "TABLE"
  ) {
    cursor += 2;
  } else {
    return;
  }

  if (
    tokens[cursor]?.upper === "IF" &&
    tokens[cursor + 1]?.upper === "EXISTS"
  ) {
    cursor += 2;
  }
  if (tokens[cursor]?.upper === "ONLY") {
    cursor += 1;
  }
  if (cursor >= tokens.length) return;

  cursor = skipQualifiedName(statement, tokens, cursor);
  if (cursor >= tokens.length) return;

  for (let i = cursor; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.depth !== 0) continue;

    const actionEnd = findNextTopLevelComma(statement, token.start);
    const end = actionEnd < 0 ? statement.length : actionEnd;

    if (token.upper === "ADD") {
      let defIndex = i + 1;
      if (tokens[defIndex]?.depth === 0 && tokens[defIndex].upper === "COLUMN") {
        defIndex += 1;
      }
      if (
        tokens[defIndex]?.depth === 0 &&
        tokens[defIndex].upper === "IF" &&
        tokens[defIndex + 1]?.depth === 0 &&
        tokens[defIndex + 1].upper === "NOT" &&
        tokens[defIndex + 2]?.depth === 0 &&
        tokens[defIndex + 2].upper === "EXISTS"
      ) {
        defIndex += 3;
      }
      const defToken = tokens[defIndex];
      if (!defToken || defToken.start >= end) continue;
      const segment = statement.slice(defToken.start, end);
      const parsed = parseDefinitionItem(segment);
      if (!parsed) continue;
      ranges.push({
        start: defToken.start + parsed.bounds.nameStart,
        end: defToken.start + parsed.bounds.typeEnd,
      });
      continue;
    }

    if (
      token.upper === "ALTER" &&
      tokens[i + 1]?.depth === 0 &&
      tokens[i + 1].upper === "COLUMN"
    ) {
      const nameToken = tokens[i + 2];
      if (!nameToken || nameToken.depth !== 0 || nameToken.start >= end) {
        continue;
      }

      let typeTokenIndex = -1;
      for (let j = i + 3; j < tokens.length; j += 1) {
        const candidate = tokens[j];
        if (candidate.start >= end) break;
        if (candidate.depth !== 0) continue;
        if (candidate.upper === "TYPE") {
          typeTokenIndex = j;
          break;
        }
        if (
          candidate.upper === "SET" ||
          candidate.upper === "RESET" ||
          candidate.upper === "DROP"
        ) {
          break;
        }
      }
      if (typeTokenIndex < 0) continue;

      ranges.push({ start: nameToken.start, end: nameToken.end });

      const typeToken = tokens[typeTokenIndex];
      let typeStart = typeToken.end;
      while (typeStart < end && /\s/.test(statement[typeStart])) {
        typeStart += 1;
      }
      let typeEnd = end;
      for (let j = typeTokenIndex + 1; j < tokens.length; j += 1) {
        const candidate = tokens[j];
        if (candidate.start >= end) break;
        if (candidate.depth !== 0) continue;
        if (ALTER_TYPE_BOUNDARY_KEYWORDS.has(candidate.upper)) {
          typeEnd = candidate.start;
          break;
        }
      }
      while (typeEnd > typeStart && /\s/.test(statement[typeEnd - 1])) {
        typeEnd -= 1;
      }
      if (typeStart < typeEnd) {
        ranges.push({ start: typeStart, end: typeEnd });
      }
    }
  }
}

function collectDefinitionRangesFromParen(
  statement: string,
  open: number,
  close: number,
  ranges: Range[],
): void {
  const content = statement.slice(open + 1, close);
  const items = splitTopLevelCommaItems(content, open + 1);
  for (const item of items) {
    const parsed = parseDefinitionItem(item.text);
    if (!parsed) continue;
    ranges.push({
      start: item.start + parsed.bounds.nameStart,
      end: item.start + parsed.bounds.typeEnd,
    });
  }
}

function splitTopLevelCommaItems(
  content: string,
  offset: number,
): Array<{ text: string; start: number; end: number }> {
  const rawRanges: Array<{ start: number; end: number }> = [];
  let segmentStart = 0;

  walkSql(
    content,
    (index, char, depth) => {
      if (char === "(" || char === ")") return true;
      if (char === "," && depth === 0) {
        rawRanges.push({ start: segmentStart, end: index });
        segmentStart = index + 1;
      }
      return true;
    },
    { trackDepth: true },
  );
  rawRanges.push({ start: segmentStart, end: content.length });

  return rawRanges
    .map((range) => trimRange(content, range.start, range.end, offset))
    .filter((item): item is { text: string; start: number; end: number } =>
      item !== null
    );
}

function trimRange(
  content: string,
  start: number,
  end: number,
  offset: number,
): { text: string; start: number; end: number } | null {
  let trimmedStart = start;
  let trimmedEnd = end;

  while (trimmedStart < trimmedEnd && /\s/.test(content[trimmedStart])) {
    trimmedStart += 1;
  }
  while (trimmedEnd > trimmedStart && /\s/.test(content[trimmedEnd - 1])) {
    trimmedEnd -= 1;
  }
  if (trimmedStart >= trimmedEnd) return null;

  return {
    text: content.slice(trimmedStart, trimmedEnd),
    start: offset + trimmedStart,
    end: offset + trimmedEnd,
  };
}

function findTopLevelEquals(text: string): number {
  let equals = -1;

  walkSql(
    text,
    (index, char, depth) => {
      if (char === "(" || char === ")") return true;
      if (char !== "=" || depth !== 0) return true;

      const prev = previousNonSpace(text, index - 1);
      const next = nextNonSpace(text, index + 1);
      if (
        prev === "<" ||
        prev === ">" ||
        prev === "!" ||
        prev === "=" ||
        next === "="
      ) {
        return true;
      }

      equals = index;
      return false;
    },
    { trackDepth: true },
  );

  return equals;
}

function previousNonSpace(text: string, index: number): string | null {
  let i = index;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;
  return i >= 0 ? text[i] : null;
}

function nextNonSpace(text: string, index: number): string | null {
  let i = index;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i < text.length ? text[i] : null;
}

function findImmediateParen(statement: string, start: number): number {
  let index = start;
  while (index < statement.length && /\s/.test(statement[index])) {
    index += 1;
  }
  return statement[index] === "(" ? index : -1;
}

function findMatchingParen(statement: string, open: number): number {
  let close = -1;
  let openDepth = -1;

  walkSql(
    statement,
    (index, char, depth) => {
      if (index === open) {
        if (char !== "(") return false;
        openDepth = depth;
        return true;
      }
      if (openDepth >= 0 && char === ")" && depth === openDepth) {
        close = index;
        return false;
      }
      return true;
    },
    { trackDepth: true, startIndex: open },
  );

  return close;
}

function findTopLevelTokenAtOrAfter(
  tokens: ReturnType<typeof scanTokens>,
  position: number,
  startIndex: number,
): number {
  for (let i = startIndex; i < tokens.length; i += 1) {
    if (tokens[i].depth === 0 && tokens[i].start >= position) return i;
  }
  return -1;
}

function findNextTopLevelComma(text: string, start: number): number {
  let comma = -1;

  walkSql(
    text,
    (index, char, depth) => {
      if (char === "," && depth === 0) {
        comma = index;
        return false;
      }
      return true;
    },
    { trackDepth: true, startIndex: start },
  );

  return comma;
}

function mergeRanges(ranges: Range[]): Range[] {
  const filtered = ranges
    .filter((range) => range.start < range.end)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Range[] = [];
  for (const range of filtered) {
    const previous = merged[merged.length - 1];
    if (!previous || range.start > previous.end) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}
