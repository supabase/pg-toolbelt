import { KEYWORDS } from "./constants.ts";
import { isWordChar, walkSql } from "./sql-scanner.ts";
import type { NormalizedOptions } from "./types.ts";

const SETTING_PAREN_KEYWORDS = new Set(["WITH", "SET", "OPTIONS", "RESET"]);
const KEY_VALUE_LINE_PATTERN = /^\s*,?\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*/;

type Range = { start: number; end: number };

export function applyKeywordCase(
  statement: string,
  options: NormalizedOptions,
): string {
  const transform =
    options.keywordCase === "upper"
      ? (value: string) => value.toUpperCase()
      : (value: string) => value.toLowerCase();

  const settingRanges = findSettingParenRanges(statement);
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
        output += shouldPreserveWordCase(statement, index, settingRanges)
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

function shouldPreserveWordCase(
  statement: string,
  wordStart: number,
  settingRanges: Range[],
): boolean {
  return (
    isInsideSettingRange(wordStart, settingRanges) ||
    isKeyValueLine(statement, wordStart)
  );
}

function isInsideSettingRange(index: number, ranges: Range[]): boolean {
  return ranges.some((range) => index > range.start && index < range.end);
}

function isKeyValueLine(statement: string, wordStart: number): boolean {
  const lineStart = statement.lastIndexOf("\n", wordStart - 1) + 1;
  const lineEndIndex = statement.indexOf("\n", wordStart);
  const lineEnd = lineEndIndex === -1 ? statement.length : lineEndIndex;
  const line = statement.slice(lineStart, lineEnd);
  return KEY_VALUE_LINE_PATTERN.test(line);
}

function findSettingParenRanges(statement: string): Range[] {
  const ranges: Range[] = [];
  const openParens: number[] = [];
  let skipUntil = -1;
  let expectSettingParen = false;
  let expectSettingParenFrom = -1;

  walkSql(
    statement,
    (index, char, depth) => {
      if (index < skipUntil) return true;

      if (expectSettingParen && index >= expectSettingParenFrom) {
        if (/\s/.test(char)) return true;
        if (char === "(" && depth === 0) {
          openParens.push(index);
          expectSettingParen = false;
          return true;
        }
        expectSettingParen = false;
      }

      if (char === ")" && depth === 0 && openParens.length > 0) {
        const start = openParens.pop()!;
        ranges.push({ start, end: index + 1 });
        return true;
      }

      if (isWordChar(char)) {
        let end = index + 1;
        while (end < statement.length && isWordChar(statement[end])) {
          end += 1;
        }
        const upper = statement.slice(index, end).toUpperCase();
        if (depth === 0 && SETTING_PAREN_KEYWORDS.has(upper)) {
          expectSettingParen = true;
          expectSettingParenFrom = end;
        }
        skipUntil = end;
      }

      return true;
    },
    { trackDepth: true },
  );

  return ranges;
}
