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
      const leading = items.map((item, index) =>
        index === 0 ? item : `, ${item}`,
      );
      return leading.join(`\n${indentStr}`);
    }

    return items.join(`,\n${indentStr}`);
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
      if (!this.options.alignColumns) {
        return row.join(" ");
      }

      const lastIndex = row.length - 1;
      if (lastIndex < 0) return "";

      const parts: string[] = [];
      for (let i = 0; i <= lastIndex; i += 1) {
        const value = row[i];
        if (i < lastIndex) {
          parts.push(value.padEnd(widths[i]));
          parts.push(joiner(i));
        } else {
          parts.push(value);
        }
      }

      return parts.join("");
    });
  }
}
