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
  // https://github.com/supabase/pg-toolbelt/issues/615 - the FK stays in place while both ends are retyped.
  [
    "alter-column-type--fk-retype-both-ends",
    { failure: 'foreign key constraint "t3_t2_id_fkey" cannot be implemented' },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/616 - the retype resets the column's collation to the type default.
  [
    "alter-column-type--collation-kept-on-retype",
    {
      failure: 'set column:public.t.c.collation: null -> "pg_catalog.\\"C\\""',
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/617 - the added default is set before the type exists and before the retype.
  [
    "alter-column-type--default-before-new-enum:forward",
    { failure: 'type "public.color" does not exist' },
  ],
  [
    "alter-column-type--default-before-new-domain:forward",
    {
      failure:
        'column "c" is of type integer but default expression is of type text',
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/618 - ADD GENERATED AS IDENTITY runs before SET NOT NULL and the type change.
  [
    "identity-operations--add-identity-needs-not-null-and-type:forward",
    { failure: "must be declared NOT NULL before identity can be added" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/619 - the enum rebuild retypes the column while a policy still references it.
  [
    "type-ops--enum-remove-label-policy:forward",
    { failure: "cannot alter type of a column used in a policy definition" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/620 - the retype always casts directly, even where no cast exists.
  [
    "alter-column-type--no-cast:forward",
    { failure: "cannot cast type text[] to integer" },
  ],
  [
    "alter-column-type--no-cast:reverse",
    { failure: "cannot cast type integer to text[]" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/635 - the collation is dropped and re-created while a column uses it.
  // The libc scenario fails on every major; the ICU one (the issue's form) is PG 15+ only because of #641.
  [
    "collation-ops--libc-locale-change-used-by-column",
    {
      failure:
        "cannot drop collation public.co because other objects depend on it",
    },
  ],
  [
    "collation-ops--determinism-change-used-by-column",
    {
      failure:
        "cannot drop collation public.co because other objects depend on it",
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/636 - the function is dropped while a generated column still calls it.
  // PG 15+ refuses the drop; PG 14 drops the column with the function, so the proof reports drift. Only the function name is common.
  [
    "function-ops--replace-used-by-generated-column",
    { failure: "public.f(integer)" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/640 - the new range is created before the old one releases its multirange name.
  [
    "type-ops--range-reuses-old-multirange-name",
    { failure: 'type "r1_multirange" already exists' },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/641 - PG 14 keeps an ICU collation's locale in collcollate, so the extractor reads null.
  [
    "collation-ops--icu-create:forward",
    { maxMajor: 14, failure: "expected a scalar, got null" },
  ],
]);
