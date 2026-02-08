import { walkSql } from "./sql-scanner.ts";
import type { NormalizedOptions } from "./types.ts";

export function wrapStatement(
  statement: string,
  options: NormalizedOptions,
  noWrapPlaceholders: Set<string>,
): string {
  const lines = statement.split(/\r?\n/);
  const wrapped: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("--")) {
      wrapped.push(line);
      continue;
    }

    if (hasNoWrapPlaceholder(line, noWrapPlaceholders)) {
      wrapped.push(line);
      continue;
    }

    wrapped.push(...wrapLine(line, options));
  }

  return wrapped.join("\n");
}

function hasNoWrapPlaceholder(line: string, placeholders: Set<string>): boolean {
  for (const token of placeholders) {
    if (line.includes(token)) return true;
  }
  return false;
}

function wrapLine(line: string, options: NormalizedOptions): string[] {
  const maxWidth = options.maxWidth;
  if (maxWidth <= 0 || line.length <= maxWidth) {
    return [line];
  }

  const indentMatch = line.match(/^\s*/);
  const baseIndent = indentMatch ? indentMatch[0] : "";
  const continuationIndent = `${baseIndent}${indentString(options.indent)}`;

  let remaining = line;
  const output: string[] = [];

  while (remaining.length > maxWidth) {
    const breakpoint = findWrapPosition(remaining, maxWidth);
    if (breakpoint <= 0) break;

    const head = remaining.slice(0, breakpoint).trimEnd();
    const tail = remaining.slice(breakpoint).trimStart();
    output.push(head);
    const next = `${continuationIndent}${tail}`;
    if (next.length >= remaining.length) {
      remaining = next;
      break;
    }
    remaining = next;
  }

  output.push(remaining);
  return output;
}

function findWrapPosition(text: string, maxWidth: number): number {
  let lastWhitespace = -1;

  walkSql(
    text,
    (index, char) => {
      if (index > maxWidth) return false;
      if (char === " " || char === "\t") {
        lastWhitespace = index;
      }
    },
  );

  return lastWhitespace;
}

function indentString(size: number): string {
  return " ".repeat(size);
}
