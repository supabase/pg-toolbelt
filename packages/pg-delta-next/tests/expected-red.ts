/**
 * The EXPECTED_RED ledger (stage 0): scenarios whose engine support has not
 * landed yet. A listed test MUST fail (red = engine missing, pinned); an
 * accidentally-green listed test fails the suite so flipping an entry is
 * always a deliberate one-line diff.
 *
 * Entries are scenario directory names; a `:reverse` suffix pins only the
 * teardown direction.
 */
export const EXPECTED_RED: ReadonlySet<string> = new Set<string>([
  // PostgreSQL forbids USING a value added by ALTER TYPE … ADD VALUE inside
  // the same transaction ("unsafe use of new value"). This direction adds
  // enum values AND rebuilds a view referencing them — it needs the
  // three-valued execution-context segmentation (target-architecture §3.7,
  // not yet implemented; the executor is single-transaction today).
  "mixed-objects--enum-replace-with-dependents:reverse",
]);
