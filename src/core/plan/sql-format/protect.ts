import { readDollarTag } from "./sql-scanner.ts";
import { scanTokens } from "./tokenizer.ts";
import type { NormalizedOptions, ProtectedSegments, Token } from "./types.ts";

export function protectSegments(
  statement: string,
  options: NormalizedOptions,
): ProtectedSegments {
  let text = statement;
  const placeholders = new Map<string, string>();
  const noWrapPlaceholders = new Set<string>();
  let counter = 0;

  if (options.preserveRoutineBodies) {
    ({ text, counter } = protectTailAfterAs(text, ["FUNCTION", "PROCEDURE"], {
      placeholders,
      noWrapPlaceholders,
      counter,
    }));
  }

  if (options.preserveViewBodies) {
    ({ text, counter } = protectTailAfterAs(text, ["VIEW"], {
      placeholders,
      noWrapPlaceholders,
      counter,
    }));
  }

  if (options.preserveRuleBodies) {
    ({ text, counter } = protectTailAfterAs(text, ["RULE"], {
      placeholders,
      noWrapPlaceholders,
      counter,
    }));
  }

  ({ text, counter } = protectDollarQuotes(text, {
    placeholders,
    noWrapPlaceholders,
    counter,
  }));

  return { text, placeholders, noWrapPlaceholders };
}

function protectTailAfterAs(
  text: string,
  objectKeywords: string[],
  state: {
    placeholders: Map<string, string>;
    noWrapPlaceholders: Set<string>;
    counter: number;
  },
): { text: string; counter: number } {
  const tokens = scanTokens(text);
  if (tokens.length === 0) return { text, counter: state.counter };

  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].upper !== "CREATE") continue;

    let cursor = i + 1;
    if (
      tokens[cursor]?.upper === "OR" &&
      tokens[cursor + 1]?.upper === "REPLACE"
    ) {
      cursor += 2;
    }

    const objectToken = tokens[cursor];
    if (!objectToken || !objectKeywords.includes(objectToken.upper)) {
      continue;
    }

    const asToken = tokens
      .slice(cursor + 1)
      .find(
        (token) =>
          token.upper === "AS" &&
          token.depth === 0 &&
          isKeywordBoundary(text, token),
      );

    if (!asToken) continue;

    const placeholder = makePlaceholder(state.counter);
    state.counter += 1;
    state.placeholders.set(placeholder, text.slice(asToken.start));
    state.noWrapPlaceholders.add(placeholder);
    const updated = `${text.slice(0, asToken.start)}${placeholder}`;
    return { text: updated, counter: state.counter };
  }

  return { text, counter: state.counter };
}

function protectDollarQuotes(
  text: string,
  state: {
    placeholders: Map<string, string>;
    noWrapPlaceholders: Set<string>;
    counter: number;
  },
): { text: string; counter: number } {
  let output = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const next = text[i + 1];

    if (inLineComment) {
      output += char;
      if (char === "\n") {
        inLineComment = false;
      }
      i += 1;
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        output += "*/";
        inBlockComment = false;
        i += 2;
        continue;
      }
      output += char;
      i += 1;
      continue;
    }

    if (inSingleQuote) {
      output += char;
      if (char === "'") {
        if (next === "'") {
          output += next;
          i += 2;
          continue;
        }
        inSingleQuote = false;
      }
      i += 1;
      continue;
    }

    if (inDoubleQuote) {
      output += char;
      if (char === '"') {
        if (next === '"') {
          output += next;
          i += 2;
          continue;
        }
        inDoubleQuote = false;
      }
      i += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      output += "--";
      inLineComment = true;
      i += 2;
      continue;
    }

    if (char === "/" && next === "*") {
      output += "/*";
      inBlockComment = true;
      i += 2;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      output += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      output += char;
      i += 1;
      continue;
    }

    if (char === "$") {
      const tag = readDollarTag(text, i);
      if (tag) {
        const start = i;
        const end = text.indexOf(tag, i + tag.length);
        if (end !== -1) {
          const placeholder = makePlaceholder(state.counter);
          state.counter += 1;
          state.placeholders.set(
            placeholder,
            text.slice(start, end + tag.length),
          );
          output += placeholder;
          i = end + tag.length;
          continue;
        }
        output += char;
        i += 1;
        continue;
      }
    }

    output += char;
    i += 1;
  }

  return { text: output, counter: state.counter };
}

export function restorePlaceholders(
  text: string,
  placeholders: Map<string, string>,
): string {
  let output = text;
  for (const [placeholder, value] of placeholders.entries()) {
    output = output.replaceAll(placeholder, () => value);
  }
  return output;
}

function isKeywordBoundary(statement: string, token: Token): boolean {
  const before = statement[token.start - 1];
  const after = statement[token.end];
  const isBoundary = (value: string | undefined) =>
    value === undefined || !/[A-Za-z0-9_$.]/.test(value);
  return isBoundary(before) && isBoundary(after);
}

function makePlaceholder(index: number): string {
  return `__PGDELTA_PLACEHOLDER_${index}__`;
}
