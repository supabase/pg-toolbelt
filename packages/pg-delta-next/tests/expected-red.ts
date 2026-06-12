/**
 * The EXPECTED_RED ledger (stage 0): scenarios whose engine support has not
 * landed yet. A listed test MUST fail (red = engine missing, pinned); an
 * accidentally-green listed test fails the suite so flipping an entry is
 * always a deliberate one-line diff.
 *
 * Entries are scenario directory names; a `:reverse` suffix pins only the
 * teardown direction.
 */
export const EXPECTED_RED: ReadonlySet<string> = new Set<string>([]);
