const RESET = "\u001b[0m";

type TextFormatter = (value: string) => string;

export interface AnsiPalette {
  readonly bold: TextFormatter;
  readonly cyan: TextFormatter;
  readonly dim: TextFormatter;
  readonly gray: TextFormatter;
  readonly green: TextFormatter;
  readonly greenDim: TextFormatter;
  readonly red: TextFormatter;
  readonly redDim: TextFormatter;
  readonly yellow: TextFormatter;
  readonly yellowDim: TextFormatter;
  readonly guide: TextFormatter;
}

const identity: TextFormatter = (value) => value;

const wrap =
  (enabled: boolean, ...codes: readonly string[]): TextFormatter =>
  (value) =>
    enabled ? `${codes.join("")}${value}${RESET}` : value;

export const createAnsiPalette = (enabled: boolean): AnsiPalette => ({
  bold: wrap(enabled, "\u001b[1m"),
  cyan: wrap(enabled, "\u001b[36m"),
  dim: wrap(enabled, "\u001b[2m"),
  gray: wrap(enabled, "\u001b[90m"),
  green: wrap(enabled, "\u001b[32m"),
  greenDim: wrap(enabled, "\u001b[2m", "\u001b[32m"),
  red: wrap(enabled, "\u001b[31m"),
  redDim: wrap(enabled, "\u001b[2m", "\u001b[31m"),
  yellow: wrap(enabled, "\u001b[33m"),
  yellowDim: wrap(enabled, "\u001b[2m", "\u001b[33m"),
  guide: wrap(enabled, "\u001b[38;2;74;74;74m"),
});

export const maybeColorize = (
  enabled: boolean,
  formatter: TextFormatter,
): TextFormatter => (enabled ? formatter : identity);
