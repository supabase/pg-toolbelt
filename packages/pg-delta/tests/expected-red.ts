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
  /** Text (or pattern) the failure must contain. A pinned direction that fails for any
   *  other reason fails the suite, so a new bug cannot hide behind the pin. */
  failure?: string | RegExp;
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
  // PG 15+ refuses the drop; PG 14 drops the column with the function, so the proof reports drift.
  [
    "function-ops--replace-used-by-generated-column",
    {
      failure:
        /cannot drop function public\.f\(integer\) because other objects depend on it|proof failed\s+drift:\s+add column:public\.t\.c\b/,
    },
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
  // https://github.com/supabase/pg-toolbelt/issues/627 - an explicit grant to the previous owner is never issued after the owner change (ALTER ... OWNER TO moves the old owner's ACL entries)
  [
    "ownership--grant-to-previous-owner:forward",
    { failure: "add acl:(function:public.f()).corpus_prev_owner" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/628 - the applying role's default privilege still grants the reader SELECT on a table created for another owner
  [
    "default-privileges-edge-case--new-table-for-other-owner:forward",
    { failure: "remove acl:(table:public.t).corpus_dp_reader" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/630 - a schema-level default privilege to its own role is planned as REVOKE ... FROM PUBLIC, a no-op
  [
    "default-privileges-edge-case--schema-grant-to-self:forward",
    { failure: "add defaultPrivilege:corpus_dp_writer.app.f.PUBLIC" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/630 - a global default-privilege revoke from the role itself is planned as a no-op GRANT
  [
    "default-privileges-edge-case--global-revoke-from-self:forward",
    { failure: 'add defaultPrivilege:corpus_dp_writer."".r.corpus_dp_writer' },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/639 - renaming a table and its column together renames only the table (forward)
  [
    "rename--table-and-column:forward",
    { failure: "add column:public.t_r.c_r" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/639 - renaming a table and its column together renames only the table (reverse)
  [
    "rename--table-and-column:reverse",
    { failure: "remove column:public.t.c_r" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a column named by a trigger's UPDATE OF (forward)
  [
    "rename--column-named-by-trigger-update-of:forward",
    {
      failure: /dependency cycle among[\s\S]*RENAME COLUMN "c0" TO "c0_r"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a column named by a trigger's UPDATE OF (reverse)
  [
    "rename--column-named-by-trigger-update-of:reverse",
    {
      failure: /dependency cycle among[\s\S]*RENAME COLUMN "c0_r" TO "c0"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a column read by a trigger's WHEN (forward)
  [
    "rename--column-read-by-trigger-when:forward",
    {
      failure: /dependency cycle among[\s\S]*RENAME COLUMN "id" TO "id_r"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a column read by a trigger's WHEN (reverse)
  [
    "rename--column-read-by-trigger-when:reverse",
    {
      failure: /dependency cycle among[\s\S]*RENAME COLUMN "id_r" TO "id"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a composite type a column uses (forward)
  [
    "rename--composite-type-used-by-column:forward",
    {
      failure:
        /dependency cycle among[\s\S]*ALTER TYPE "public"\."c0" RENAME TO "c0_r"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a composite type a column uses (reverse)
  [
    "rename--composite-type-used-by-column:reverse",
    {
      failure:
        /dependency cycle among[\s\S]*ALTER TYPE "public"\."c0_r" RENAME TO "c0"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a rename plus an owner change of the containing schema (forward)
  [
    "rename--table-with-schema-owner-change:forward",
    {
      failure:
        /dependency cycle among[\s\S]*ALTER TABLE "app"\."t0" RENAME TO "t0_r"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a rename plus an owner change of the containing schema (reverse)
  [
    "rename--table-with-schema-owner-change:reverse",
    {
      failure:
        /dependency cycle among[\s\S]*ALTER TABLE "app"\."t0_r" RENAME TO "t0"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a column rename plus a body change of a function its default calls (forward)
  [
    "rename--column-with-function-body-change:forward",
    {
      failure: /dependency cycle among[\s\S]*RENAME COLUMN "c" TO "c_r"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a column rename plus a body change of a function its default calls (reverse)
  [
    "rename--column-with-function-body-change:reverse",
    {
      failure: /dependency cycle among[\s\S]*RENAME COLUMN "c_r" TO "c"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a column renamed on a table the same plan re-creates (forward)
  [
    "rename--column-on-recreated-table:forward",
    {
      failure: /dependency cycle among[\s\S]*RENAME COLUMN "c1" TO "c1_r"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/637 - rename detection throws a dependency cycle: a column renamed on a table the same plan re-creates (reverse)
  [
    "rename--column-on-recreated-table:reverse",
    {
      failure: /dependency cycle among[\s\S]*RENAME COLUMN "c1_r" TO "c1"/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/622 - ALTER COLUMN TYPE is also planned on the child's merged column.
  [
    "table-ops--inherits-redeclared-column-retype",
    { failure: 'cannot alter inherited column "x"' },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/623 - before PG 18 the parent's DROP NOT NULL recurses into the child's own NOT NULL.
  [
    "table-ops--inherits-parent-drop-not-null:forward",
    { maxMajor: 17, failure: "set column:s.c.a.notNull: false -> true" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/624 - the column REVOKE is ordered both before the DROP and after ADD COLUMN.
  [
    "partitioned-table-operations--partitioned-to-plain-column-grant:forward",
    {
      failure:
        /dependency cycle among(?=[\s\S]*DROP TABLE "public"\."t")(?=[\s\S]*REVOKE ALL \("a"\) ON TABLE "public"\."t")(?=[\s\S]*ADD COLUMN "a")/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/625 - ADD/DROP TABLE p also covers its inheritance child, which is then planned again.
  [
    "publication-operations--inheritance-children-membership:forward",
    { failure: 'relation "c" is already member of publication "pub_inh"' },
  ],
  [
    "publication-operations--inheritance-children-membership:reverse",
    { failure: 'relation "c" is not part of the publication' },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/625 - DROP TABLE p also removes c, which the plan never re-adds.
  [
    "publication-operations--inheritance-membership-moves-to-child:forward",
    { failure: "add publicationRel:pub_inh.s.c" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/625 - ADD TABLE p fails because c is already a member.
  [
    "publication-operations--inheritance-membership-moves-to-child:reverse",
    { failure: 'relation "c" is already member of publication "pub_inh"' },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/626 - an FK to the partitioned table gives each partition a constraint row, so a bare DROP TABLE of a partition is refused (DETACH first).
  [
    "partitioned-table-operations--drop-partition-referenced-by-fk:forward",
    { failure: "cannot drop table s.t_a because other objects depend on it" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/626 - moving a hash partition is a DROP + CREATE, refused for the same reason.
  [
    "partitioned-table-operations--move-partition-sibling-fk",
    { failure: "cannot drop table s.t_a because other objects depend on it" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/632 - p and c are both replaced around the FK between them, and the plan loops.
  [
    "table-ops--inherits-parent-to-partitioned-fk-to-child:forward",
    {
      failure:
        /dependency cycle among(?=[\s\S]*DROP TABLE "s"\."c")(?=[\s\S]*DROP TABLE "s"\."p")(?=[\s\S]*ADD CONSTRAINT "p_fk" FOREIGN KEY)/,
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/633 - the proof's count(*) on a parent includes its children's rows.
  [
    "table-ops--inherits-drop-child-keeps-parent-rows:forward",
    { failure: '"s"."p": 2 -> 1 rows' },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/634 - leaving the parent drops and re-creates the child, losing its row. The
  // reverse direction's replacement is pinned in corpus/table-ops--inherits-join-leave-parent/budget.json.
  [
    "table-ops--inherits-join-leave-parent:forward",
    { failure: '"s"."p": 2 -> 1 rows' },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/638 - the attached partition index is dropped on its own, which PostgreSQL refuses.
  [
    "partitioned-table-operations--partition-index-rename",
    { failure: "because index s.t_ix requires it" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/638 - a new partition keeps the generated index name; the rename never reaches it.
  [
    "partitioned-table-operations--new-partition-custom-index-name:forward",
    { failure: "remove index:s.t_a_k_idx" },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/677 - t1 is created with a column of t2's row type before the ALTER that rewrites t2.
  [
    "table-ops--rowtype-column-blocks-add-domain-column:forward",
    {
      failure:
        'cannot alter table "t2" because column "t1.r" uses its row type',
    },
  ],
  [
    "table-ops--rowtype-column-blocks-retype:forward",
    {
      failure:
        'cannot alter table "t2" because column "t1.r" uses its row type',
    },
  ],
  // https://github.com/supabase/pg-toolbelt/issues/678 - the enum rebuild creates the type without its privileges.
  [
    "type-ops--enum-remove-label-keeps-grant:forward",
    { failure: "add acl:(type:public.mood).corpus_enum_user" },
  ],
  [
    "type-ops--enum-remove-label-keeps-public-revoke:forward",
    {
      failure: 'set acl:(type:public.mood).PUBLIC.privileges: ["USAGE"] -> []',
    },
  ],
]);
