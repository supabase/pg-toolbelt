/**
 * The EXPECTED_RED ledger (stage 0): scenarios whose engine support has not
 * landed yet. A listed test MUST fail (red = engine missing, pinned); an
 * accidentally-green listed test fails the suite so flipping an entry is
 * always a deliberate one-line diff.
 *
 * Keys are scenario directory names; a `:reverse` suffix pins only the
 * teardown direction. A pin with `minMajor` / `maxMajor` applies only on
 * PostgreSQL majors in that range — outside it the scenario runs normally and
 * must PASS (version-dependent server behavior, e.g. PG16 dependent-privilege
 * tracking).
 */
export interface RedPin {
  /** Pin applies only when the server major is >= this (absent = all). */
  minMajor?: number;
  /** Pin applies only when the server major is <= this (absent = all). */
  maxMajor?: number;
  /** Text the failure must contain. A pinned direction that fails for any
   *  other reason fails the suite, so a new bug cannot hide behind the pin. */
  failure?: string;
}

export const EXPECTED_RED: ReadonlyMap<string, RedPin> = new Map<
  string,
  RedPin
>([
  // F3: the membership drop now emits a plain REVOKE (no CASCADE). Tearing down
  // a multi-grantor membership where the removed grant has a dependent onward
  // grant fails LOUDLY on PG16+ ("dependent privileges exist") instead of
  // silently CASCADE-destroying the kept grant. Convergent regrant that would
  // let this teardown converge is tracked separately (#333); until it lands the
  // reverse (teardown) direction is expected-red ON PG16+ ONLY — pre-16 has no
  // dependent tracking, plain REVOKE succeeds, and the scenario passes.
  ["role-membership-dedup--multi-grantor:reverse", { minMajor: 16 }],
  // Reverse is an enum value-set rebuild (drop 'c') while DOMAIN dst still
  // depends on the enum — the planner refuses that, same as any domain-over-enum
  // shrink. Forward (ADD VALUE + SET DEFAULT through the domain) is the hole
  // this pin's sibling scenario covers.
  ["type-ops--enum-add-value-used-in-domain-default:reverse", {}],
  // Inheritance children that redeclare a parent column (attislocal and
  // attinhcount > 0). Detection only; the fixes are tracked in
  // docs/roadmap/pg-delta-next-follow-ups.md#redeclared-inherited-columns.
  // Creating the child: its local columns arrive as ADD COLUMN after
  // CREATE TABLE ... INHERITS, which Postgres rejects for an inherited name.
  [
    "table-ops--inherits-redeclared-column:reverse",
    { failure: 'column "x" of relation "z_child" already exists' },
  ],
  [
    "table-ops--inherits-redeclared-column-parent-default:reverse",
    { failure: 'column "x" of relation "z_child" already exists' },
  ],
  [
    "table-ops--inherits-redeclared-column-multi-parent:reverse",
    { failure: 'column "x" inherits conflicting default values' },
  ],
  // Parent and kept child change x together: no ordering edge between the
  // parent's and the child's column actions.
  [
    "table-ops--inherits-redeclared-column-add-with-parent:forward",
    { failure: 'column "x" of relation "z_child" already exists' },
  ],
  [
    "table-ops--inherits-redeclared-column-drop-with-parent:forward",
    { failure: 'cannot drop inherited column "x"' },
  ],
  // An existing child starts or stops redeclaring an inherited column.
  [
    "table-ops--inherits-redeclared-column-on-existing-child:forward",
    { failure: 'column "x" of relation "z_child" already exists' },
  ],
  [
    "table-ops--inherits-redeclared-column-on-existing-child:reverse",
    { failure: 'cannot drop inherited column "x"' },
  ],
]);
