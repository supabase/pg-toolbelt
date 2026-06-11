import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

function expectNoTableReplacement(sqlStatements: string[]) {
  expect(
    sqlStatements.some((statement) => statement.startsWith("DROP TABLE ")),
  ).toBe(false);
  expect(
    sqlStatements.some((statement) => statement.startsWith("CREATE TABLE ")),
  ).toBe(false);
}

async function expectTableRowCount(
  query: (sql: string) => Promise<{ rows: Array<{ count: string | bigint }> }>,
  tableName: string,
  expected: number,
) {
  const { rows } = await query(`SELECT count(*) FROM ${tableName}`);
  expect(Number(rows[0]?.count)).toBe(expected);
}

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`function signature expression dependencies (pg${pgVersion})`, () => {
    test(
      "column default update for replaced function signature does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.default_quantity(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.orders (
              id integer NOT NULL,
              quantity integer DEFAULT test_schema.default_quantity(1::integer)
            );

            INSERT INTO test_schema.orders (id) VALUES (1);
          `,
          testSql: dedent`
            CREATE FUNCTION test_schema.default_quantity(value bigint)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value::integer + 2
            $function$;

            ALTER TABLE test_schema.orders
              ALTER COLUMN quantity
              SET DEFAULT test_schema.default_quantity(1::bigint);

            DROP FUNCTION test_schema.default_quantity(integer);
          `,
          assertSqlStatements: expectNoTableReplacement,
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.orders",
          1,
        );
      }),
    );

    test(
      "check constraint update for replaced function signature does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.is_positive(value integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value > 0
            $function$;

            CREATE TABLE test_schema.measurements (
              id integer NOT NULL,
              value integer NOT NULL,
              CONSTRAINT measurements_value_check
                CHECK (test_schema.is_positive(value))
            );

            INSERT INTO test_schema.measurements (id, value) VALUES (1, 10);
          `,
          testSql: dedent`
            CREATE FUNCTION test_schema.is_positive(value bigint)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value > 1
            $function$;

            ALTER TABLE test_schema.measurements
              DROP CONSTRAINT measurements_value_check;
            ALTER TABLE test_schema.measurements
              ADD CONSTRAINT measurements_value_check
              CHECK (test_schema.is_positive(value::bigint));

            DROP FUNCTION test_schema.is_positive(integer);
          `,
          assertSqlStatements: expectNoTableReplacement,
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.measurements",
          1,
        );
      }),
    );

    test(
      "unchanged check constraint for replaced function argument name does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.is_valid(value integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value > 0
            $function$;

            CREATE TABLE test_schema.measurement_labels (
              id integer NOT NULL,
              value integer NOT NULL,
              CONSTRAINT measurement_labels_value_check
                CHECK (test_schema.is_valid(value))
            );

            INSERT INTO test_schema.measurement_labels (id, value)
            VALUES (1, 10);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.measurement_labels
              DROP CONSTRAINT measurement_labels_value_check;

            DROP FUNCTION test_schema.is_valid(integer);

            CREATE FUNCTION test_schema.is_valid(input integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input > 0
            $function$;

            ALTER TABLE test_schema.measurement_labels
              ADD CONSTRAINT measurement_labels_value_check
              CHECK (test_schema.is_valid(value));
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.measurement_labels DROP CONSTRAINT measurement_labels_value_check",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.is_valid"),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE FUNCTION test_schema.is_valid"),
            );
            const addConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.measurement_labels ADD CONSTRAINT measurement_labels_value_check",
              ),
            );

            expect(dropConstraintIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropConstraintIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(addConstraintIndex).toBeGreaterThan(createFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.measurement_labels",
          1,
        );
      }),
    );

    test(
      "removed check constraint for replaced function argument name does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.is_allowed(value integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value > 0
            $function$;

            CREATE TABLE test_schema.measurement_inputs (
              id integer NOT NULL,
              value integer NOT NULL,
              CONSTRAINT measurement_inputs_value_check
                CHECK (test_schema.is_allowed(value))
            );

            INSERT INTO test_schema.measurement_inputs (id, value)
            VALUES (1, 10);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.measurement_inputs
              DROP CONSTRAINT measurement_inputs_value_check;

            DROP FUNCTION test_schema.is_allowed(integer);

            CREATE FUNCTION test_schema.is_allowed(input integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input > 0
            $function$;
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.measurement_inputs DROP CONSTRAINT measurement_inputs_value_check",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.is_allowed"),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE FUNCTION test_schema.is_allowed"),
            );

            expect(dropConstraintIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropConstraintIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.measurement_inputs",
          1,
        );
      }),
    );

    test(
      "removed column default for replaced function argument name does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.default_input(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.form_inputs (
              id integer NOT NULL,
              value integer DEFAULT test_schema.default_input(1::integer),
              keep_value integer NOT NULL
            );

            INSERT INTO test_schema.form_inputs (id, keep_value)
            VALUES (1, 10);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.form_inputs
              DROP COLUMN value;

            DROP FUNCTION test_schema.default_input(integer);

            CREATE FUNCTION test_schema.default_input(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.form_inputs DROP COLUMN value",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.default_input"),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE FUNCTION test_schema.default_input"),
            );

            expect(dropColumnIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropColumnIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.form_inputs",
          1,
        );
      }),
    );

    test.skipIf(pgVersion < 17)(
      "generated column update for replaced function signature does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.invoices (
              id integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_total(subtotal)) STORED
            );

            INSERT INTO test_schema.invoices (id, subtotal) VALUES (1, 20);
          `,
          testSql: dedent`
            CREATE FUNCTION test_schema.compute_total(value bigint)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value::integer + 2
            $function$;

            ALTER TABLE test_schema.invoices
              ALTER COLUMN total
              SET EXPRESSION AS
                (test_schema.compute_total(subtotal::bigint));

            DROP FUNCTION test_schema.compute_total(integer);
          `,
          assertSqlStatements: expectNoTableReplacement,
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.invoices",
          1,
        );
      }),
    );

    test.skipIf(pgVersion < 17)(
      "generated column update for replaced function argument name does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_invoice_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.invoice_totals (
              id integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_invoice_total(subtotal)) STORED
            );

            INSERT INTO test_schema.invoice_totals (id, subtotal)
            VALUES (1, 20);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.invoice_totals
              DROP COLUMN total;

            DROP FUNCTION test_schema.compute_invoice_total(integer);

            CREATE FUNCTION test_schema.compute_invoice_total(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            ALTER TABLE test_schema.invoice_totals
              ADD COLUMN total integer GENERATED ALWAYS AS
                (test_schema.compute_invoice_total(subtotal + 1)) STORED;
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            expect(
              sqlStatements.some((statement) =>
                statement.includes(" SET EXPRESSION AS "),
              ),
            ).toBe(false);

            const dropColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals DROP COLUMN total",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.compute_invoice_total",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.compute_invoice_total",
              ),
            );
            const addColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals ADD COLUMN total",
              ),
            );

            expect(dropColumnIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropColumnIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(addColumnIndex).toBeGreaterThan(createFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.invoice_totals",
          1,
        );
      }),
    );

    test(
      "unchanged generated column for replaced function argument name does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_invoice_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.invoice_totals (
              id integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_invoice_total(subtotal)) STORED
            );

            INSERT INTO test_schema.invoice_totals (id, subtotal)
            VALUES (1, 20);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.invoice_totals
              DROP COLUMN total;

            DROP FUNCTION test_schema.compute_invoice_total(integer);

            CREATE FUNCTION test_schema.compute_invoice_total(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            ALTER TABLE test_schema.invoice_totals
              ADD COLUMN total integer GENERATED ALWAYS AS
                (test_schema.compute_invoice_total(subtotal)) STORED;
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals DROP COLUMN total",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.compute_invoice_total",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.compute_invoice_total",
              ),
            );
            const addColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals ADD COLUMN total",
              ),
            );

            expect(dropColumnIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropColumnIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(addColumnIndex).toBeGreaterThan(createFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.invoice_totals",
          1,
        );
      }),
    );

    test(
      "unchanged commented generated column for replaced function argument name does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_invoice_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.invoice_totals (
              id integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_invoice_total(subtotal)) STORED
            );

            COMMENT ON COLUMN test_schema.invoice_totals.total
              IS 'computed invoice total';

            INSERT INTO test_schema.invoice_totals (id, subtotal)
            VALUES (1, 20);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.invoice_totals
              DROP COLUMN total;

            DROP FUNCTION test_schema.compute_invoice_total(integer);

            CREATE FUNCTION test_schema.compute_invoice_total(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            ALTER TABLE test_schema.invoice_totals
              ADD COLUMN total integer GENERATED ALWAYS AS
                (test_schema.compute_invoice_total(subtotal)) STORED;

            COMMENT ON COLUMN test_schema.invoice_totals.total
              IS 'computed invoice total';
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals DROP COLUMN total",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.compute_invoice_total",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.compute_invoice_total",
              ),
            );
            const addColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals ADD COLUMN total",
              ),
            );
            const commentIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "COMMENT ON COLUMN test_schema.invoice_totals.total",
              ),
            );

            expect(dropColumnIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropColumnIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(addColumnIndex).toBeGreaterThan(createFunctionIndex);
            expect(commentIndex).toBeGreaterThan(addColumnIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.invoice_totals",
          1,
        );
        const { rows } = await db.main.query(dedent`
          SELECT col_description(attrelid, attnum) AS comment
          FROM pg_catalog.pg_attribute
          WHERE attrelid = 'test_schema.invoice_totals'::regclass
            AND attname = 'total'
        `);
        expect(rows[0]?.comment).toBe("computed invoice total");
      }),
    );

    test(
      "unchanged generated column with retained dependents does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_invoice_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.invoice_totals (
              id integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_invoice_total(subtotal)) STORED,
              CONSTRAINT invoice_totals_total_nonnegative CHECK (total >= 0)
            );

            CREATE INDEX invoice_totals_total_idx
              ON test_schema.invoice_totals (total);

            CREATE VIEW test_schema.invoice_total_values AS
              SELECT id, total FROM test_schema.invoice_totals;

            INSERT INTO test_schema.invoice_totals (id, subtotal)
            VALUES (1, 20);
          `,
          testSql: dedent`
            DROP VIEW test_schema.invoice_total_values;

            DROP INDEX test_schema.invoice_totals_total_idx;

            ALTER TABLE test_schema.invoice_totals
              DROP CONSTRAINT invoice_totals_total_nonnegative;

            ALTER TABLE test_schema.invoice_totals
              DROP COLUMN total;

            DROP FUNCTION test_schema.compute_invoice_total(integer);

            CREATE FUNCTION test_schema.compute_invoice_total(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            ALTER TABLE test_schema.invoice_totals
              ADD COLUMN total integer GENERATED ALWAYS AS
                (test_schema.compute_invoice_total(subtotal)) STORED;

            ALTER TABLE test_schema.invoice_totals
              ADD CONSTRAINT invoice_totals_total_nonnegative CHECK (total >= 0);

            CREATE INDEX invoice_totals_total_idx
              ON test_schema.invoice_totals (total);

            CREATE VIEW test_schema.invoice_total_values AS
              SELECT id, total FROM test_schema.invoice_totals;
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropViewIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP VIEW test_schema.invoice_total_values",
              ),
            );
            const dropIndexIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP INDEX test_schema.invoice_totals_total_idx",
              ),
            );
            const dropConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals DROP CONSTRAINT invoice_totals_total_nonnegative",
              ),
            );
            const dropColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals DROP COLUMN total",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.compute_invoice_total",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.compute_invoice_total",
              ),
            );
            const addColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals ADD COLUMN total",
              ),
            );
            const addConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals ADD CONSTRAINT invoice_totals_total_nonnegative",
              ),
            );
            const createIndexIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE INDEX invoice_totals_total_idx ON test_schema.invoice_totals",
              ),
            );
            const createViewIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE VIEW test_schema.invoice_total_values",
              ),
            );

            expect(dropViewIndex).toBeGreaterThanOrEqual(0);
            expect(dropIndexIndex).toBeGreaterThanOrEqual(0);
            expect(dropConstraintIndex).toBeGreaterThanOrEqual(0);
            expect(dropColumnIndex).toBeGreaterThan(dropViewIndex);
            expect(dropColumnIndex).toBeGreaterThan(dropIndexIndex);
            expect(dropColumnIndex).toBeGreaterThan(dropConstraintIndex);
            expect(dropFunctionIndex).toBeGreaterThan(dropColumnIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(addColumnIndex).toBeGreaterThan(createFunctionIndex);
            expect(addConstraintIndex).toBeGreaterThan(addColumnIndex);
            expect(createIndexIndex).toBeGreaterThan(addColumnIndex);
            expect(createViewIndex).toBeGreaterThan(addColumnIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.invoice_totals",
          1,
        );
        const { rows } = await db.main.query(
          "SELECT to_regclass('test_schema.invoice_totals_total_idx')::text AS index_name",
        );
        expect(rows[0]?.index_name).toBe(
          "test_schema.invoice_totals_total_idx",
        );
      }),
    );

    test(
      "domain default update for replaced function signature does not recreate domain or table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.default_score(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE DOMAIN test_schema.score AS integer
              DEFAULT test_schema.default_score(1::integer);

            CREATE TABLE test_schema.results (
              id integer NOT NULL,
              score test_schema.score
            );

            INSERT INTO test_schema.results (id) VALUES (1);
          `,
          testSql: dedent`
            CREATE FUNCTION test_schema.default_score(value bigint)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value::integer + 2
            $function$;

            ALTER DOMAIN test_schema.score
              SET DEFAULT test_schema.default_score(1::bigint);

            DROP FUNCTION test_schema.default_score(integer);
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);
            expect(
              sqlStatements.some((statement) =>
                statement.startsWith("DROP DOMAIN "),
              ),
            ).toBe(false);
            expect(
              sqlStatements.some((statement) =>
                statement.startsWith("CREATE DOMAIN "),
              ),
            ).toBe(false);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.results",
          1,
        );
      }),
    );

    test(
      "unchanged domain check constraint for replaced function argument name does not recreate domain or table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.accept_score(value integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value > 0
            $function$;

            CREATE DOMAIN test_schema.score AS integer
              CONSTRAINT score_accepts_value
              CHECK (test_schema.accept_score(VALUE));

            CREATE TABLE test_schema.results (
              id integer NOT NULL,
              score test_schema.score
            );

            INSERT INTO test_schema.results (id, score) VALUES (1, 10);
          `,
          testSql: dedent`
            ALTER DOMAIN test_schema.score
              DROP CONSTRAINT score_accepts_value;

            DROP FUNCTION test_schema.accept_score(integer);

            CREATE FUNCTION test_schema.accept_score(input integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input > 0
            $function$;

            ALTER DOMAIN test_schema.score
              ADD CONSTRAINT score_accepts_value
              CHECK (test_schema.accept_score(VALUE));
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);
            expect(
              sqlStatements.some((statement) =>
                statement.startsWith("DROP DOMAIN "),
              ),
            ).toBe(false);
            expect(
              sqlStatements.some((statement) =>
                statement.startsWith("CREATE DOMAIN "),
              ),
            ).toBe(false);

            const dropConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER DOMAIN test_schema.score DROP CONSTRAINT score_accepts_value",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.accept_score"),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE FUNCTION test_schema.accept_score"),
            );
            const addConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER DOMAIN test_schema.score ADD CONSTRAINT score_accepts_value",
              ),
            );

            expect(dropConstraintIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropConstraintIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(addConstraintIndex).toBeGreaterThan(createFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.results",
          1,
        );
      }),
    );
  });
}
