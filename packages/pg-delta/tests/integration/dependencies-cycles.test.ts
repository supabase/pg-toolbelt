/**
 * Integration tests to identify and validate dependency cycles in statement sorting.
 *
 * This test suite focuses on identifying the specific cycles that occur when
 * sorting statements, particularly the cycle between sequences owned by columns
 * and tables created with columns that reference those sequences via DEFAULT.
 */

import { describe, test } from "bun:test";
import type { PgDepend } from "../../src/core/depend.ts";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`dependency cycles (pg${pgVersion})`, () => {
    test(
      "sequence owned by column cycle with table default",
      withDb(pgVersion, async (db) => {
        /**
         * This test identifies the ONLY current cycle we have when sorting statements:
         *
         * CYCLE DESCRIPTION:
         * - A sequence is owned by a table column (via OWNED BY)
         * - A table is created with a column that uses that sequence via DEFAULT nextval(...)
         *
         * DEPENDENCIES CREATING THE CYCLE:
         * 1. Column default (pg_attrdef) → Sequence (via pg_depend: column default depends on sequence)
         *    - This creates: column:test_schema.users.id → sequence:test_schema.user_id_seq
         * 2. Sequence → Column/Table (via pg_depend: sequence ownership, deptype='a')
         *    - This creates: sequence:test_schema.user_id_seq → column:test_schema.users.id
         *    - OR: sequence:test_schema.user_id_seq → table:test_schema.users
         *
         * CYCLE PATH:
         * sequence:test_schema.user_id_seq → column:test_schema.users.id → sequence:test_schema.user_id_seq
         * OR
         * sequence:test_schema.user_id_seq → table:test_schema.users → sequence:test_schema.user_id_seq
         *
         * HOW IT'S BROKEN:
         * The dependency-filter.ts filters out the ownership dependency FROM the sequence
         * TO the table/column it's owned by, breaking the cycle. This is safe because:
         * - CREATE phase: sequences should be created before tables (ownership set via ALTER SEQUENCE OWNED BY after both exist)
         * - DROP phase: prevents cycles when dropping sequences owned by tables that aren't being dropped
         *
         * EXPECTED ORDER (after cycle breaking):
         * 1. CREATE SEQUENCE (no dependencies)
         * 2. CREATE TABLE (depends on sequence via column default)
         * 3. ALTER SEQUENCE OWNED BY (depends on table/column)
         */
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE SEQUENCE test_schema.user_id_seq;

          CREATE TABLE test_schema.users (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.user_id_seq')
          );

          ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
        `,
          // Validate the expected order: sequence → table → alter sequence → constraint
          // Note: PRIMARY KEY constraint is added as a separate ALTER TABLE statement
          expectedSqlTerms: [
            "CREATE SEQUENCE test_schema.user_id_seq",
            "CREATE TABLE test_schema.users (id bigint DEFAULT nextval('test_schema.user_id_seq'::regclass) NOT NULL)",
            "ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id",
            "ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id)",
          ],
          // Validate the dependencies that create the cycle
          expectedBranchDependencies: [
            // Column default depends on sequence (creates: column → sequence)
            {
              dependent_stable_id: "column:test_schema.users.id",
              referenced_stable_id: "sequence:test_schema.user_id_seq",
              deptype: "n", // or "a" - normal or auto dependency
            },
            // Sequence ownership dependency (creates: sequence → column/table, deptype='a')
            // This is the dependency that gets filtered to break the cycle
            {
              dependent_stable_id: "sequence:test_schema.user_id_seq",
              referenced_stable_id: "column:test_schema.users.id",
              deptype: "a", // auto dependency for ownership
            },
          ] as PgDepend[],
        });
      }),
    );

    test(
      "sequence owned by column cycle with ADD COLUMN SET DEFAULT",
      withDb(pgVersion, async (db) => {
        /**
         * This test verifies that the same cycle exists when using ADD COLUMN SET DEFAULT
         * on a pre-existing table instead of CREATE TABLE with DEFAULT.
         *
         * CYCLE DESCRIPTION:
         * - A sequence is owned by a table column (via OWNED BY)
         * - An existing table has a column added that uses that sequence via DEFAULT nextval(...)
         *
         * DEPENDENCIES CREATING THE CYCLE:
         * Same as the CREATE TABLE case:
         * 1. Column default (pg_attrdef) → Sequence (via pg_depend: column default depends on sequence)
         *    - This creates: column:test_schema.users.id → sequence:test_schema.user_id_seq
         * 2. Sequence → Column/Table (via pg_depend: sequence ownership, deptype='a')
         *    - This creates: sequence:test_schema.user_id_seq → column:test_schema.users.id
         *
         * EXPECTED ORDER (after cycle breaking):
         * 1. CREATE SEQUENCE (no dependencies)
         * 2. ALTER TABLE ADD COLUMN SET DEFAULT (depends on sequence via column default)
         * 3. ALTER SEQUENCE OWNED BY (depends on table/column)
         */
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            name text NOT NULL
          );
        `,
          testSql: `
          CREATE SEQUENCE test_schema.user_id_seq;

          ALTER TABLE test_schema.users
          ADD COLUMN id bigint DEFAULT nextval('test_schema.user_id_seq');

          ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id;
        `,
          // Validate the expected order: sequence → alter table add column → alter sequence
          expectedSqlTerms: [
            "CREATE SEQUENCE test_schema.user_id_seq",
            "ALTER TABLE test_schema.users ADD COLUMN id bigint DEFAULT nextval('test_schema.user_id_seq'::regclass)",
            "ALTER SEQUENCE test_schema.user_id_seq OWNED BY test_schema.users.id",
          ],
        });
      }),
    );

    test(
      "drop two tables with mutual FK references should not produce a cycle",
      withDb(pgVersion, async (db) => {
        /**
         * REPRODUCTION for CycleError seen in production:
         *
         *   CycleError: dependency graph contains a cycle involving 2 changes:
         *     1. [n] DropTable
         *     2. [m] DropTable
         *   [n] → [m] constraint:public.a.a_b_fkey → column:public.b.id
         *   [m] → [n] constraint:public.b.b_a_fkey → column:public.a.id
         *
         * Two tables each hold a FK pointing at the other; both are absent
         * from branch so both must be dropped. The pg_depend graph for the FK
         * constraints creates:
         *   constraint(A) → column(B.id) → table(B)
         *   constraint(B) → column(A.id) → table(A)
         * So DropTable(A) requires DropTable(B) AND DropTable(B) requires
         * DropTable(A) → cycle that the current cycle-breaking filter
         * (CreateSequence-only) does not handle.
         *
         * Expected (post-fix): this is handled as a post-diff normalization
         * step. Once all statements are known, the planner injects explicit
         * ALTER TABLE ... DROP CONSTRAINT statements for the mutual FKs and
         * rewrites each DropTable so it no longer claims those FK stable IDs.
         */
        await db.main.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TABLE public.a (
              id bigserial PRIMARY KEY,
              name text NOT NULL
            )`,
            `CREATE TABLE public.b (
              id bigserial PRIMARY KEY,
              name text NOT NULL,
              a_id bigint REFERENCES public.a(id)
            )`,
            `ALTER TABLE public.a
              ADD COLUMN b_id bigint`,
            `ALTER TABLE public.a
              ADD CONSTRAINT a_b_fkey
              FOREIGN KEY (b_id)
              REFERENCES public.b(id)`,
          ].join(";\n\n"),
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "drop SERIAL column on surviving table should not produce DropSequence ↔ AlterTableDropColumn cycle",
      withDb(pgVersion, async (db) => {
        /**
         * Reproduction for the DropSequence cycle family:
         *
         *   CycleError: dependency graph contains a cycle involving 2 changes:
         *     1. [N] DropSequence
         *     2. [M] <DropTable|AlterTableDropColumn>
         *
         *   [N] → [M] (source: catalog)
         *     sequence:<schema>.<seq> → column:<schema>.<table>.<col>
         *   [M] → [N] (source: catalog)
         *     column:<schema>.<table>.<col> → sequence:<schema>.<seq>
         *
         * The whole-table-drop variant is already short-circuited by
         * `diffSequences` (the owning-table skip). The other variant — a
         * SERIAL / BIGSERIAL column being dropped while its parent table
         * survives — is NOT short-circuited, so `DropSequence` is emitted
         * alongside `AlterTableDropColumn`. The pg_depend graph has
         * bidirectional edges:
         *   - sequence → column (deptype='a', OWNED BY relationship)
         *   - column   → sequence (deptype='n', column DEFAULT nextval(...))
         * Both sides produce/consume the stable IDs in the drop phase, and
         * the current cycle-breaking filter only handles `CreateSequence`,
         * so the cycle is unbreakable.
         *
         * Expected (post-fix): this stays object-local in `diffSequences`.
         * The redundant `DropSequence` is elided up front because PostgreSQL
         * cascades owned sequences when the column is dropped, so there is no
         * multi-statement cycle left for the post-diff or sort stages to fix.
         */
        await db.main.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TABLE public.widgets (
              id SERIAL PRIMARY KEY,
              label TEXT
            )`,
          ].join(";\n\n"),
        );

        await db.branch.query(
          [
            "SET LOCAL client_min_messages = error",
            // Branch keeps the table but drops the SERIAL column; PG cascades
            // the owned sequence so branch catalog has neither `id` nor the
            // owned sequence. Main still has both — diff must DROP the
            // column and the (now orphaned) sequence in the same phase.
            `CREATE TABLE public.widgets (
              label TEXT
            )`,
          ].join(";\n\n"),
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "replace-dependency DropTable + AlterTableDropColumn on same table should not cycle",
      withDb(pgVersion, async (db) => {
        /**
         * Reproduction for CycleError:
         *
         *   CycleError: dependency graph contains a cycle involving 2 changes:
         *     1. [N] DropTable
         *     2. [M] AlterTableDropColumn
         *
         *   [N] → [M] (source: catalog)
         *     constraint:<schema>.<table>.<fk_name> → column:<schema>.<table>.<col>
         *   [M] → [N] (source: explicit)
         *     column:<schema>.<table>.<col> → table:<schema>.<table>
         *
         * Key insight: both edges reference the SAME <schema>.<table>. That
         * can only happen if a single table has both `DropTable(T)` and
         * `AlterTableDropColumn(T.col)` emitted for it in the same phase,
         * which `diffTables` alone never produces (tables are partitioned
         * into dropped/altered). The extra `DropTable` must therefore come
         * from `expandReplaceDependencies`: when an object being replaced
         * (e.g. an enum that lost a label) has a dependent column on table
         * T, the expander walks `pg_depend` and enqueues a
         * `DropTable(T) + CreateTable(T)` pair. If `diffTables` had also
         * emitted `AlterTableDropColumn(T.col)` for a separate column drop
         * on T, both changes now exist on the same T in the drop phase,
         * and the explicit `column → table` edge closes the cycle against
         * the catalog FK edge.
         *
         * The MRE here: a referenced enum must be REPLACED (label removed
         * → `DropEnum + CreateEnum`); the table using that enum also has
         * an FK column being dropped. `expandReplaceDependencies` then
         * expands the enum replacement to the table, producing the cycle.
         *
         * Expected (post-fix): `expandReplaceDependencies` still reports the
         * dependent table replacement, but a later post-diff normalization pass
         * prunes same-table `AlterTableDropColumn/DropConstraint` changes that
         * are superseded by the replacement pair before sorting runs.
         */
        await db.main.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TYPE public.item_status AS ENUM ('draft', 'published', 'archived')`,
            `CREATE TABLE public.parents (
              id INTEGER PRIMARY KEY,
              label TEXT
            )`,
            `CREATE TABLE public.children (
              id INTEGER PRIMARY KEY,
              parent_ref INTEGER REFERENCES public.parents(id),
              status public.item_status,
              notes TEXT
            )`,
          ].join(";\n\n"),
        );

        await db.branch.query(
          [
            "SET LOCAL client_min_messages = error",
            // Enum lost a label → diffEnums emits DropEnum+CreateEnum,
            // which expandReplaceDependencies propagates to the dependent
            // table `children`, adding DropTable(children)+CreateTable.
            `CREATE TYPE public.item_status AS ENUM ('draft', 'published')`,
            `CREATE TABLE public.parents (
              id INTEGER PRIMARY KEY,
              label TEXT
            )`,
            // children: parent_ref column is gone, forcing diffTables
            // to emit AlterTableDropColumn(children.parent_ref) in
            // parallel with the replace-dependency DropTable.
            `CREATE TABLE public.children (
              id INTEGER PRIMARY KEY,
              status public.item_status,
              notes TEXT
            )`,
          ].join(";\n\n"),
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "drop three tables with N=3 FK cycle should not produce a cycle",
      withDb(pgVersion, async (db) => {
        /**
         * Reproduction for CycleError (N=3 variant) seen in production
         * (alpha.16):
         *
         *   CycleError: dependency graph contains a cycle involving 3 changes:
         *     1. [n] DropTable
         *     2. [m] DropTable
         *     3. [k] DropTable
         *   [n] → [m] (catalog)  constraint:public.a.a_b_fkey   → column:public.b.id
         *   [m] → [k] (catalog)  constraint:public.b.b_c_fkey   → column:public.c.id
         *   [k] → [n] (catalog)  constraint:public.c.c_a_fkey   → column:public.a.id
         *
         * Three tables hold FKs forming a 3-cycle (a→b→c→a); branch has none of
         * them so all three must drop. The pg_depend graph for the FK
         * constraints creates:
         *   constraint(A) → column(B.id) → table(B)
         *   constraint(B) → column(C.id) → table(C)
         *   constraint(C) → column(A.id) → table(A)
         * so DropTable(A) requires DropTable(B), DropTable(B) requires
         * DropTable(C), DropTable(C) requires DropTable(A) → unbreakable cycle.
         *
         * The existing post-diff cycle-breaker
         * (`normalizePostDiffCycles` in `post-diff-cycle-breaking.ts`) only
         * injects pre-drop `ALTER TABLE ... DROP CONSTRAINT` for *mutual*
         * 2-cycles — `droppedFkTargets.get(referencedId)?.has(table.stableId)`.
         * No edge in a 3-cycle is mutual, so the breaker does nothing and the
         * sort phase throws.
         *
         * Expected (post-fix): the breaker should detect any strongly-connected
         * component of `DropTable` changes connected by FK edges (any N≥2),
         * inject `ALTER TABLE ... DROP CONSTRAINT` for every FK inside the
         * SCC, and remove those constraint stable IDs from the paired
         * `DropTable.requires`. This generalizes the existing 2-cycle handling.
         */
        await db.main.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TABLE public.a (
              id bigserial PRIMARY KEY,
              b_id bigint
            )`,
            `CREATE TABLE public.b (
              id bigserial PRIMARY KEY,
              c_id bigint
            )`,
            `CREATE TABLE public.c (
              id bigserial PRIMARY KEY,
              a_id bigint
            )`,
            `ALTER TABLE public.a
              ADD CONSTRAINT a_b_fkey
              FOREIGN KEY (b_id)
              REFERENCES public.b(id)`,
            `ALTER TABLE public.b
              ADD CONSTRAINT b_c_fkey
              FOREIGN KEY (c_id)
              REFERENCES public.c(id)`,
            `ALTER TABLE public.c
              ADD CONSTRAINT c_a_fkey
              FOREIGN KEY (a_id)
              REFERENCES public.a(id)`,
          ].join(";\n\n"),
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "many independent FK 2-cycles in one drop phase should all resolve",
      withDb(pgVersion, async (db) => {
        /**
         * Regression coverage for the lazy-cycle-breaker bound. The
         * sort-phase change-injection breaker is invoked once per
         * unbreakable cycle; each round resolves exactly one cycle and
         * restarts. With N independent unbreakable cycles in one phase
         * (e.g. N pairs of mutually-FKed tables all dropped at once),
         * the breaker must survive at least N+1 rounds. A fixed cap that
         * is smaller than realistic big-diff plans causes spurious
         * `CycleError` failures on otherwise correct migrations.
         *
         * Schema: 8 disjoint pairs (a0,b0) … (a7,b7) where a_i and b_i
         * each FK-reference the other. All 16 tables drop, producing
         * 8 independent FK 2-cycles in the drop phase.
         */
        const pairCount = 8;
        const setupStatements = ["SET LOCAL client_min_messages = error"];
        for (let i = 0; i < pairCount; i++) {
          setupStatements.push(
            `CREATE TABLE public.a_${i} (id bigserial PRIMARY KEY, b_id bigint)`,
            `CREATE TABLE public.b_${i} (id bigserial PRIMARY KEY, a_id bigint)`,
            `ALTER TABLE public.a_${i} ADD CONSTRAINT a_${i}_b_fkey FOREIGN KEY (b_id) REFERENCES public.b_${i}(id)`,
            `ALTER TABLE public.b_${i} ADD CONSTRAINT b_${i}_a_fkey FOREIGN KEY (a_id) REFERENCES public.a_${i}(id)`,
          );
        }
        await db.main.query(setupStatements.join(";\n\n"));

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "drop publication-listed column should not produce AlterPublicationDropTables ↔ AlterTableDropColumn cycle",
      withDb(pgVersion, async (db) => {
        /**
         * Reproduction for CycleError seen in production (alpha.16):
         *
         *   CycleError: dependency graph contains a cycle involving 2 changes:
         *     1. [0] AlterPublicationDropTables
         *     2. [N] AlterTableDropColumn
         *   [0] → [N] (catalog)
         *     publication:public.<pub> → column:public.<table>.<col>
         *   [N] → [0] (explicit)
         *     column:public.<table>.<col> → table:public.<table>
         *
         * When a publication is created with an explicit column list and the
         * column is later dropped on branch, `diffPublications` emits
         * `AlterPublicationDropTables` (the membership column-set diverges →
         * `deepEqual({ columns, row_filter })` is false at
         * `publication.diff.ts:216`) and `diffTables` emits
         * `AlterTableDropColumn` for the same column. The publication's
         * pg_depend includes a 'normal' dependency on the listed column,
         * giving the catalog edge `publication → column`. The synthesized
         * explicit edge `column → table` (from the column-drop's `requires`
         * including the parent table) closes the cycle.
         *
         * Expected (post-fix): root-cause investigation per the issue draft
         * — audit whether the explicit `column → table` edge belongs on
         * `AlterTableDropColumn`. If the edge is justified, the post-diff
         * normalizer should recognize that `AlterPublicationDropTables` can
         * always run before any column or table drop and drop that
         * publication→column edge in the drop-phase graph.
         */
        await db.main.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TABLE public.lab_results (
              id bigint PRIMARY KEY,
              flash_summary text
            )`,
            `CREATE PUBLICATION cycle_repro_realtime
              FOR TABLE public.lab_results (id, flash_summary)`,
          ].join(";\n\n"),
        );

        await db.branch.query(
          [
            "SET LOCAL client_min_messages = error",
            // Branch keeps the table and the publication, but the column is
            // gone — so the publication's column list shrinks to (id) only.
            `CREATE TABLE public.lab_results (
              id bigint PRIMARY KEY
            )`,
            `CREATE PUBLICATION cycle_repro_realtime
              FOR TABLE public.lab_results (id)`,
          ].join(";\n\n"),
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "alter sequence data_type while owning column survives should not produce DropSequence cycle",
      withDb(pgVersion, async (db) => {
        /**
         * Reproduction for the production CycleError observed in
         * @supabase/pg-delta@1.0.0-alpha.16 (Sentry SUPABASE-API-7RS).
         *
         * Real-world diff (anonymised pg_dump):
         *   origin: CREATE SEQUENCE seq AS integer
         *           CREATE TABLE bar (id integer DEFAULT nextval('seq'::regclass) NOT NULL)
         *           ALTER SEQUENCE seq OWNED BY bar.id
         *   branch: CREATE SEQUENCE seq           -- default bigint, no AS
         *           CREATE TABLE bar (id integer DEFAULT nextval('seq'::regclass) NOT NULL)
         *           -- NO OWNED BY
         *
         * Sequence.data_type is in dataFields(), so the sequence shows up
         * in the `altered` set of diffSequences. NON_ALTERABLE_FIELDS at
         * sequence.diff.ts:153-156 includes "data_type", which makes
         * hasNonAlterableChanges() return true, and the replace branch at
         * sequence.diff.ts:163-214 emits `DropSequence + CreateSequence`
         * unconditionally. expandReplaceDependencies then promotes the
         * surviving table (which has DEFAULT nextval(seq) referencing
         * the sequence's stableId) to a `DropTable + CreateTable` pair,
         * and the bidirectional pg_depend edges between the sequence and
         * the column close a 2-cycle in the drop phase that no breaker
         * can resolve:
         *
         *   CycleError: dependency graph contains a cycle involving 2 changes:
         *     1. [N] DropSequence(public.addons_addon_id_seq)
         *     2. [M] DropTable(public.addons)
         *
         * NB: the existing alpha.15 short-circuit at sequence.diff.ts:117-145
         * only guards the `dropped` loop (the owning table or column being
         * dropped). It does not run on this `altered` path.
         *
         * Expected (post-fix): data_type is alterable in PG10+ via
         * `ALTER SEQUENCE foo AS bigint`, so the diff should emit a
         * single `AlterSequenceSetOptions` carrying the AS clause plus an
         * `AlterSequenceSetOwnedBy(null)`. No DropSequence is emitted, no
         * cycle is produced, and the sequence's last_value is preserved
         * (the current Drop+Create silently resets it to the START WITH
         * value, which is a separate data-loss bug).
         */
        await db.main.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TABLE public.addons (
              addon_id integer NOT NULL,
              label text NOT NULL
            )`,
            `CREATE SEQUENCE public.addons_addon_id_seq AS integer`,
            `ALTER TABLE public.addons
               ALTER COLUMN addon_id
               SET DEFAULT nextval('public.addons_addon_id_seq'::regclass)`,
            `ALTER SEQUENCE public.addons_addon_id_seq
               OWNED BY public.addons.addon_id`,
          ].join(";\n\n"),
        );

        await db.branch.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TABLE public.addons (
              addon_id integer NOT NULL,
              label text NOT NULL
            )`,
            // Default sequence type is bigint; no OWNED BY clause.
            `CREATE SEQUENCE public.addons_addon_id_seq`,
            `ALTER TABLE public.addons
               ALTER COLUMN addon_id
               SET DEFAULT nextval('public.addons_addon_id_seq'::regclass)`,
          ].join(";\n\n"),
        );

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "drop table that owns a SERIAL sequence should not produce DropSequence ↔ DropTable cycle",
      withDb(pgVersion, async (db) => {
        /**
         * Regression coverage for the production (alpha.16) cycle:
         *
         *   CycleError: dependency graph contains a cycle involving 2 changes:
         *     1. [N] DropSequence(public.addons_addon_id_seq)
         *     2. [M] DropTable(public.addons)
         *   [N] → [M] (catalog)  sequence → column
         *   [M] → [N] (catalog)  column → sequence
         *
         * The whole-table-drop short-circuit at `sequence.diff.ts:124-143`
         * (landed in alpha.15, #203) skips emitting `DropSequence` when the
         * owning table is absent from `branchTables`. The production Sentry
         * events span 11d, reaching back into pre-fix deployments, so the
         * shape that fired in alpha.16 is already handled here. This test
         * pins that short-circuit so the fix can't silently regress and a
         * future cycle-handling change can't reintroduce the same
         * `DropSequence ↔ DropTable` pair.
         */
        await db.main.query(
          [
            "SET LOCAL client_min_messages = error",
            `CREATE TABLE public.addons (
              addon_id SERIAL PRIMARY KEY,
              label TEXT
            )`,
          ].join(";\n\n"),
        );

        // Branch is empty → table (and its owned sequence) must drop.

        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
        });
      }),
    );

    test(
      "sequence owned by column cycle - multiple sequences",
      withDb(pgVersion, async (db) => {
        /**
         * Test multiple sequences with the same cycle pattern to ensure
         * the cycle-breaking logic works consistently across multiple objects.
         *
         * This test verifies that the cycle-breaking filter works correctly
         * even when there are multiple independent cycles in the same migration.
         * The exact order of independent sequences/tables may vary, but the
         * important thing is that cycles are broken and the migration succeeds.
         */
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: "CREATE SCHEMA test_schema;",
          testSql: `
          CREATE SEQUENCE test_schema.order_id_seq;
          CREATE SEQUENCE test_schema.item_id_seq;

          CREATE TABLE test_schema.orders (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.order_id_seq')
          );

          CREATE TABLE test_schema.items (
            id bigint PRIMARY KEY DEFAULT nextval('test_schema.item_id_seq')
          );

          ALTER SEQUENCE test_schema.order_id_seq OWNED BY test_schema.orders.id;
          ALTER SEQUENCE test_schema.item_id_seq OWNED BY test_schema.items.id;
        `,
          // No strict ordering check - independent sequences/tables can be in any order
          // The important thing is that cycles are broken and migration succeeds
        });
      }),
    );
  });
}
