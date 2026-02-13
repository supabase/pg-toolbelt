export const asRecord = (
  value: unknown,
): Record<string, unknown> | undefined =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
