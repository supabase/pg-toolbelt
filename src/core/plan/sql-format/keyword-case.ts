import { KEYWORDS } from "./constants.ts";
import { isWordChar, walkSql } from "./sql-scanner.ts";
import type { NormalizedOptions } from "./types.ts";

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
      if (index < skipUntil) return;
      if (isWordChar(char)) {
        let end = index + 1;
        while (end < statement.length && isWordChar(statement[end])) {
          end += 1;
        }
        const word = statement.slice(index, end);
        const upper = word.toUpperCase();
        output += KEYWORDS.has(upper) ? transform(word) : word;
        skipUntil = end;
        return;
      }
      output += char;
    },
    {
      onSkipped: (chunk) => {
        output += chunk;
      },
    },
  );

  return output;
}
