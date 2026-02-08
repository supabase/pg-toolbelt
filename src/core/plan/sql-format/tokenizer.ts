import { isWordChar, walkSql } from "./sql-scanner.ts";
import type { Token } from "./types.ts";

export function scanTokens(statement: string): Token[] {
  const tokens: Token[] = [];
  let skipUntil = -1;

  walkSql(
    statement,
    (index, char, depth) => {
      if (index < skipUntil) return;
      if (char === "(" || char === ")") return;
      if (isWordChar(char)) {
        let end = index + 1;
        while (end < statement.length && isWordChar(statement[end])) {
          end += 1;
        }
        const value = statement.slice(index, end);
        tokens.push({
          value,
          upper: value.toUpperCase(),
          start: index,
          end,
          depth,
        });
        skipUntil = end;
      }
    },
    { trackDepth: true },
  );

  return tokens;
}

export function findTopLevelParen(
  statement: string,
  startIndex: number,
): { open: number; close: number } | null {
  let result: { open: number; close: number } | null = null;
  let openIndex: number | null = null;

  walkSql(
    statement,
    (index, char, depth) => {
      if (char === "(") {
        if (depth === 0) {
          openIndex = index;
        }
        return;
      }
      if (char === ")") {
        if (depth === 0 && openIndex !== null) {
          result = { open: openIndex, close: index };
          return false;
        }
      }
    },
    { trackDepth: true, startIndex },
  );

  return result;
}

export function splitByCommas(content: string): string[] {
  const items: string[] = [];
  let buffer = "";

  walkSql(
    content,
    (_index, char, depth) => {
      if (char === "(" || char === ")") {
        buffer += char;
        return;
      }
      if (char === "," && depth === 0) {
        items.push(buffer);
        buffer = "";
        return;
      }
      buffer += char;
    },
    {
      trackDepth: true,
      onSkipped: (chunk) => {
        buffer += chunk;
      },
    },
  );

  if (buffer.length > 0) {
    items.push(buffer);
  }

  return items.map((item) => item.trim()).filter((item) => item.length > 0);
}
