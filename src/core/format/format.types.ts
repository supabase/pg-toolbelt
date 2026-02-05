export type KeywordCase = "preserve" | "upper" | "lower";
export type CommaStyle = "trailing" | "leading";

export interface SqlFormatOptions {
  /** Enable formatting (opt-in). */
  enabled?: boolean;
  /** Keyword case transformation. */
  keywordCase?: KeywordCase;
  /** Maximum line width. */
  lineWidth?: number;
  /** Spaces per indentation level. */
  indentWidth?: number;
  /** Comma placement style. */
  commaStyle?: CommaStyle;
  /** Align column definitions in CREATE TABLE. */
  alignColumns?: boolean;
}

export const DEFAULT_FORMAT_OPTIONS: Required<SqlFormatOptions> = {
  enabled: false,
  keywordCase: "upper",
  lineWidth: 80,
  indentWidth: 2,
  commaStyle: "trailing",
  alignColumns: true,
};
