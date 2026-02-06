import type { SqlFormatOptions } from "./format.types.ts";
import { DEFAULT_FORMAT_OPTIONS } from "./format.types.ts";

export class SqlFormatter {
  private readonly options: Required<SqlFormatOptions>;

  constructor(options: SqlFormatOptions = {}) {
    this.options = {
      ...DEFAULT_FORMAT_OPTIONS,
      ...options,
    };
  }

  /** Transform keyword to configured case. */
  keyword(kw: string): string {
    switch (this.options.keywordCase) {
      case "preserve":
        return kw;
      case "lower":
        return kw.toLowerCase();
      case "upper":
      default:
        return kw.toUpperCase();
    }
  }

  /** Create indentation string for given level. */
  indent(level: number = 1): string {
    const width = Math.max(0, this.options.indentWidth);
    const depth = Math.max(0, level);
    return " ".repeat(width * depth);
  }

  /**
   * Join items with proper comma placement and line breaks.
   * The caller is responsible for prefixing indentation on the first line.
   */
  list(items: string[], indent: number = 0): string {
    if (items.length === 0) return "";
    const indentStr = this.indent(indent);

    if (this.options.commaStyle === "leading") {
      if (items.length === 1) return items[0];
      const prefix = ", ";
      const pad = " ".repeat(prefix.length);
      const leading = items.map((item, index) =>
        index === 0 ? `${pad}${item}` : `${prefix}${item}`,
      );
      return leading.join(`\n${indentStr}`);
    }

    return items.join(`,\n${indentStr}`);
  }

  private wrapLine(text: string): string {
    const width = this.options.lineWidth;
    if (!width || width <= 0) return text;
    if (text.length <= width) return text;

    if (text.includes("\n")) {
      return text
        .split("\n")
        .map((lineText) => this.wrapLine(lineText))
        .join("\n");
    }

    const leading = text.match(/^\s*/)?.[0] ?? "";
    const continuationIndent = leading + this.indent(1);
    const words = text.trim().split(/\s+/);
    if (words.length <= 1) return text;

    const lines: string[] = [];
    let current = leading;
    let currentLen = leading.length;

    for (const word of words) {
      const sep = current.trim().length === 0 ? "" : " ";
      if (
        current.trim().length > 0 &&
        currentLen + sep.length + word.length > width
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
  }

  /**
   * Join parts into a single line and wrap to lineWidth when needed.
   */
  line(...parts: Array<string | null | undefined>): string {
    const filtered = parts.filter(
      (part) => part !== undefined && part !== null && part !== "",
    ) as string[];
    return this.wrapLine(filtered.join(" "));
  }

  /** Wrap content in parentheses, optionally multi-line. */
  parens(content: string, multiline: boolean = false): string {
    if (!multiline || content.trim() === "") {
      return `(${content})`;
    }
    return `(${"\n"}${content}${"\n"})`;
  }

  /** Align multi-column data by padding each column to max width. */
  alignColumns(rows: Array<Array<string | null | undefined>>, separators?: string[]): string[] {
    if (rows.length === 0) return [];

    const normalized = rows.map((row) => row.map((value) => value ?? ""));
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
          const padded = this.options.alignColumns
            ? value.padEnd(widths[i])
            : value;
          parts.push(padded);
          parts.push(joiner(i));
        } else {
          parts.push(value);
        }
      }

      return parts.join("");
    });
  }
}
