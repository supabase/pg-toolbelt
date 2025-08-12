export type Comparator<T> = (a: T, b: T) => boolean;

type Indexable<T> = { [P in keyof T]: unknown };

export function hasNonAlterableChanges<T, K extends keyof T>(
  main: T,
  branch: T,
  keys: ReadonlyArray<K>,
  comparators?: Partial<Record<K, Comparator<unknown>>>,
): boolean {
  const mainIndexable = main as unknown as Indexable<T>;
  const branchIndexable = branch as unknown as Indexable<T>;
  for (const key of keys) {
    // Prefer custom comparator when provided; fallback to strict equality
    const equals =
      (comparators?.[key] as Comparator<unknown>) ??
      ((a: unknown, b: unknown) => a === b);
    if (!equals(mainIndexable[key], branchIndexable[key])) return true;
  }
  return false;
}

export const deepEqual: Comparator<unknown> = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
