export function normalizeCliOutput(
  value: string,
  replacements: Record<string, string>,
): string {
  let normalized = value;

  for (const [from, to] of Object.entries(replacements)) {
    normalized = normalized.split(from).join(to);
  }

  return normalized;
}
