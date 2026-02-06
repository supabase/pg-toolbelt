import type { SqlFormatOptions } from "./format.types.ts";
import { DEFAULT_FORMAT_OPTIONS } from "./format.types.ts";

export type FormatContext = {
  /**
   * Whether pretty formatting is enabled for this context.
   * @example
   * pretty // true when format.enabled is true
   */
  pretty: boolean;
  /**
   * Format a SQL keyword based on keyword case rules.
   * @example
   * keyword("create") // "CREATE" (when keywordCase is "upper")
   */
  keyword: (kw: string) => string;
  /**
   * Return indentation spaces for a given nesting level.
   * @example
   * indent(2) // "    " when indentWidth is 2
   */
  indent: (level?: number) => string;
  /**
   * Join parts into a single line, skipping empty parts.
   * @example
   * line("CREATE", "TABLE", "t") // "CREATE TABLE t"
   */
  line: (...parts: Array<string | null | undefined>) => string;
  /**
   * Join an array of lines into a single SQL string.
   * @example
   * joinLines(["A", "B"]) // "A\nB" when pretty is true
   */
  joinLines: (lines: string[]) => string;
  /**
   * Format a comma-separated list with optional indentation.
   * @example
   * list(["a", "b"], 1) // "a,\n  b" when pretty is true
   */
  list: (items: string[], indentLevel?: number) => string;
  /**
   * Wrap content in parentheses, optionally multiline.
   * @example
   * parens("a,\n  b", true) // "(\n... \n)" when pretty is true
   */
  parens: (content: string, multiline?: boolean) => string;
  /**
   * Align tabular rows into columns using spacing.
   * @example
   * alignColumns([["id", "bigint"], ["name", "text"]])
   * // ["id   bigint", "name text"] when alignColumns is true
   */
  alignColumns: (
    rows: Array<Array<string | null | undefined>>,
    separators?: string[],
  ) => string[];
};

export function createFormatContext(
  options?: SqlFormatOptions,
): FormatContext {
  const merged = {
    ...DEFAULT_FORMAT_OPTIONS,
    ...options,
  };
  const pretty = options?.enabled ?? false;
  const keywordCase = pretty ? merged.keywordCase : "upper";
  const commaStyle = pretty ? merged.commaStyle : "trailing";
  const alignColumns = pretty ? merged.alignColumns : false;
  const indentWidth = pretty ? merged.indentWidth : 0;
  const wrapWidth =
    pretty && typeof options?.lineWidth === "number"
      ? options.lineWidth
      : null;

  const keyword = (kw: string): string => {
    switch (keywordCase) {
      case "preserve":
        return kw;
      case "lower":
        return kw.toLowerCase();
      case "upper":
      default:
        return kw.toUpperCase();
    }
  };

  const indent = (level: number = 1): string => {
    const width = Math.max(0, indentWidth);
    const depth = Math.max(0, level);
    return " ".repeat(width * depth);
  };

  const wrapLine = (text: string): string => {
    if (!pretty || !wrapWidth || wrapWidth <= 0) return text;
    if (text.length <= wrapWidth) return text;

    if (text.includes("\n")) {
      return text
        .split("\n")
        .map((lineText) => wrapLine(lineText))
        .join("\n");
    }

    const leading = text.match(/^\s*/)?.[0] ?? "";
    const continuationIndent = leading + " ".repeat(Math.max(0, indentWidth));
    const words = text.trim().split(/\s+/);
    if (words.length <= 1) return text;

    const lines: string[] = [];
    let current = leading;
    let currentLen = leading.length;

    for (const word of words) {
      const sep = current.trim().length === 0 ? "" : " ";
      if (
        current.trim().length > 0 &&
        currentLen + sep.length + word.length > wrapWidth
      ) {
        lines.push(current);
        current = `${continuationIndent}${word}`;
        currentLen = continuationIndent.length + word.length;
        continue;
      }

      current += `${sep}${word}`;
      currentLen += sep.length + word.length;
    }

    if (current) lines.push(current);
    return lines.join("\n");
  };

  const line = (...parts: Array<string | null | undefined>): string => {
    const filtered = parts.filter(
      (part) => part !== undefined && part !== null && part !== "",
    ) as string[];
    return wrapLine(filtered.join(" "));
  };

  const joinLines = (lines: string[]): string =>
    pretty
      ? lines.map((lineText) => wrapLine(lineText)).join("\n")
      : lines.join(" ");

  const list = (items: string[], indentLevel: number = 0): string => {
    if (items.length === 0) return "";
    if (!pretty) {
      return items.join(", ");
    }

    const indentStr = indent(indentLevel);
    if (commaStyle === "leading") {
      if (items.length === 1) return items[0];
      const prefix = ", ";
      const pad = " ".repeat(prefix.length);
      const leading = items.map((item, index) =>
        index === 0 ? `${pad}${item}` : `${prefix}${item}`,
      );
      return leading.join(`\n${indentStr}`);
    }

    return items.join(`,\n${indentStr}`);
  };

  const parens = (content: string, multiline: boolean = false): string => {
    if (!pretty || !multiline || content.trim() === "") {
      return `(${content})`;
    }
    return `(\n${content}\n)`;
  };

  const alignColumnsFn = (
    rows: Array<Array<string | null | undefined>>,
    separators?: string[],
  ): string[] => {
    if (rows.length === 0) return [];
    const normalized = rows.map((row) => row.map((value) => value ?? ""));
    if (!alignColumns) {
      return normalized.map((row) => row.join(" "));
    }

    const maxColumns = normalized.reduce(
      (max, row) => Math.max(max, row.length),
      0,
    );

    const widths = new Array<number>(maxColumns).fill(0);
    for (const row of normalized) {
      for (let i = 0; i < row.length; i += 1) {
        widths[i] = Math.max(widths[i], row[i].length);
      }
    }

    const joiner = (index: number): string => {
      if (!separators || separators.length === 0) return " ";
      return separators[index] ?? " ";
    };

    return normalized.map((row) => {
      const lastIndex = row.length - 1;
      if (lastIndex < 0) return "";

      const parts: string[] = [];
      for (let i = 0; i <= lastIndex; i += 1) {
        const value = row[i];
        if (i < lastIndex) {
          const padded = alignColumns ? value.padEnd(widths[i]) : value;
          parts.push(padded);
          parts.push(joiner(i));
        } else {
          parts.push(value);
        }
      }

      return parts.join("");
    });
  };

  return {
    pretty,
    keyword,
    indent,
    line,
    joinLines,
    list,
    parens,
    alignColumns: alignColumnsFn,
  };
}
