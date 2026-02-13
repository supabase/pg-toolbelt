import { KEYWORDS } from "./constants.ts";
import { isWordChar, walkSql } from "./sql-scanner.ts";
import { scanTokens } from "./tokenizer.ts";
import type { NormalizedOptions, Token } from "./types.ts";

export function applyKeywordCase(
  statement: string,
  options: NormalizedOptions,
): string {
  const transform =
    options.keywordCase === "upper"
      ? (value: string) => value.toUpperCase()
      : (value: string) => value.toLowerCase();

  let output = "";
  let skipUntil = -1;

  walkSql(
    statement,
    (index, char) => {
      if (index < skipUntil) return true;
      if (isWordChar(char)) {
        let end = index + 1;
        while (end < statement.length && isWordChar(statement[end])) {
          end += 1;
        }
        const word = statement.slice(index, end);
        const upper = word.toUpperCase();
        output += KEYWORDS.has(upper) ? transform(word) : word;
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

  return applyContextualPublicCase(output, options);
}

function applyContextualPublicCase(
  statement: string,
  options: NormalizedOptions,
): string {
  const tokens = scanTokens(statement);
  if (tokens.length === 0) return statement;

  const commandStarts: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].depth !== 0) continue;
    if (tokens[i].upper === "GRANT" || tokens[i].upper === "REVOKE") {
      commandStarts.push(i);
    }
  }
  if (commandStarts.length === 0) return statement;

  const publicValue = options.keywordCase === "upper" ? "PUBLIC" : "public";
  const replacements: Array<{ start: number; end: number; value: string }> = [];

  for (let i = 0; i < commandStarts.length; i += 1) {
    const segmentStart = commandStarts[i];
    const segmentEnd =
      i + 1 < commandStarts.length ? commandStarts[i + 1] : tokens.length;
    const command = tokens[segmentStart].upper;

    if (command === "GRANT") {
      collectGrantPublic(
        statement,
        tokens,
        segmentStart,
        segmentEnd,
        publicValue,
        replacements,
      );
    } else {
      collectRevokePublic(
        statement,
        tokens,
        segmentStart,
        segmentEnd,
        publicValue,
        replacements,
      );
    }
  }

  if (replacements.length === 0) return statement;

  replacements.sort((a, b) => b.start - a.start);
  let output = statement;
  for (const replacement of replacements) {
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(replacement.end)}`;
  }
  return output;
}

function collectGrantPublic(
  statement: string,
  tokens: Token[],
  segmentStart: number,
  segmentEnd: number,
  publicValue: string,
  replacements: Array<{ start: number; end: number; value: string }>,
): void {
  const toIndex = findTopLevelToken(tokens, segmentStart + 1, segmentEnd, "TO");
  if (toIndex === -1) return;

  const stopIndex = findFirstTopLevelToken(
    tokens,
    toIndex + 1,
    segmentEnd,
    new Set(["WITH"]),
  );
  const granteeEnd = stopIndex === -1 ? segmentEnd : stopIndex;

  collectPublicReplacements(
    statement,
    tokens,
    toIndex + 1,
    granteeEnd,
    publicValue,
    replacements,
  );
}

function collectRevokePublic(
  statement: string,
  tokens: Token[],
  segmentStart: number,
  segmentEnd: number,
  publicValue: string,
  replacements: Array<{ start: number; end: number; value: string }>,
): void {
  const fromIndex = findTopLevelToken(
    tokens,
    segmentStart + 1,
    segmentEnd,
    "FROM",
  );
  if (fromIndex === -1) return;

  const stopIndex = findFirstTopLevelToken(
    tokens,
    fromIndex + 1,
    segmentEnd,
    new Set(["CASCADE", "RESTRICT"]),
  );
  const granteeEnd = stopIndex === -1 ? segmentEnd : stopIndex;

  collectPublicReplacements(
    statement,
    tokens,
    fromIndex + 1,
    granteeEnd,
    publicValue,
    replacements,
  );
}

function collectPublicReplacements(
  statement: string,
  tokens: Token[],
  start: number,
  end: number,
  publicValue: string,
  replacements: Array<{ start: number; end: number; value: string }>,
): void {
  for (let i = start; i < end; i += 1) {
    const token = tokens[i];
    if (token.depth !== 0 || token.upper !== "PUBLIC") continue;
    if (isDotAdjacent(statement, token)) continue;
    replacements.push({ start: token.start, end: token.end, value: publicValue });
  }
}

function findTopLevelToken(
  tokens: Token[],
  start: number,
  end: number,
  upper: string,
): number {
  for (let i = start; i < end; i += 1) {
    if (tokens[i].depth === 0 && tokens[i].upper === upper) return i;
  }
  return -1;
}

function findFirstTopLevelToken(
  tokens: Token[],
  start: number,
  end: number,
  candidates: Set<string>,
): number {
  for (let i = start; i < end; i += 1) {
    if (tokens[i].depth === 0 && candidates.has(tokens[i].upper)) return i;
  }
  return -1;
}

function isDotAdjacent(statement: string, token: Token): boolean {
  return statement[token.start - 1] === "." || statement[token.end] === ".";
}
