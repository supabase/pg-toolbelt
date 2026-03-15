export const quoteIdentifier = (value: string): string =>
  `"${value.replaceAll('"', '""')}"`;
