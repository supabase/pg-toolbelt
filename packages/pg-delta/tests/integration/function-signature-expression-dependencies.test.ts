import { describe, expect, test } from "bun:test";
import dedent from "dedent";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

function expectNoTableReplacement(sqlStatements: string[]) {
  expect(
    sqlStatements.filter(
      (statement) =>
        statement.startsWith("DROP TABLE ") ||
        statement.startsWith("CREATE TABLE "),
    ),
  ).toEqual([]);
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
      "dependent view is recreated when aggregate signature changes",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE TABLE test_schema.aggregate_inputs (
              value integer NOT NULL
            );

            CREATE AGGREGATE test_schema.total_value(integer) (
              SFUNC = int4pl,
              STYPE = integer,
              INITCOND = '0'
            );

            CREATE VIEW test_schema.aggregate_totals AS
              SELECT test_schema.total_value(value) AS total
              FROM test_schema.aggregate_inputs;

            INSERT INTO test_schema.aggregate_inputs (value) VALUES (1);
          `,
          testSql: dedent`
            DROP VIEW test_schema.aggregate_totals;

            DROP AGGREGATE test_schema.total_value(integer);

            CREATE AGGREGATE test_schema.total_value(bigint) (
              SFUNC = int8pl,
              STYPE = bigint,
              INITCOND = '0'
            );

            CREATE VIEW test_schema.aggregate_totals AS
              SELECT test_schema.total_value(value::bigint) AS total
              FROM test_schema.aggregate_inputs;
          `,
          assertSqlStatements: (sqlStatements) => {
            const dropViewIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP VIEW test_schema.aggregate_totals"),
            );
            const dropAggregateIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP AGGREGATE test_schema.total_value(integer)",
              ),
            );
            const createAggregateIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE AGGREGATE test_schema.total_value(bigint)",
              ),
            );
            const createViewIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE VIEW test_schema.aggregate_totals"),
            );

            expect(dropViewIndex).toBeGreaterThanOrEqual(0);
            expect(dropAggregateIndex).toBeGreaterThan(dropViewIndex);
            expect(createAggregateIndex).toBeGreaterThan(dropAggregateIndex);
            expect(createViewIndex).toBeGreaterThan(createAggregateIndex);
          },
        });

        const { rows } = await db.main.query(
          "SELECT total FROM test_schema.aggregate_totals",
        );
        expect(rows[0]?.total).toBe(1n);
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
      "unchanged check constraint for overloaded replacement drops old function before restore",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.is_valid_score(value integer)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value > 0
            $function$;

            CREATE TABLE test_schema.score_labels (
              id integer NOT NULL,
              value integer NOT NULL,
              CONSTRAINT score_labels_value_check
                CHECK (test_schema.is_valid_score(value))
            );

            INSERT INTO test_schema.score_labels (id, value)
            VALUES (1, 10);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.score_labels
              DROP CONSTRAINT score_labels_value_check;

            CREATE FUNCTION test_schema.is_valid_score(value bigint)
            RETURNS boolean
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value > 0
            $function$;

            DROP FUNCTION test_schema.is_valid_score(integer);

            ALTER TABLE test_schema.score_labels
              ADD CONSTRAINT score_labels_value_check
              CHECK (test_schema.is_valid_score(value));
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.score_labels DROP CONSTRAINT score_labels_value_check",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.is_valid_score",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.is_valid_score"),
            );
            const addConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.score_labels ADD CONSTRAINT score_labels_value_check",
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
          "test_schema.score_labels",
          1,
        );
      }),
    );

    test(
      "unchanged generated column with retained dependents does not recreate table",
      withDbIsolated(pgVersion, async (db) => {
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
                (test_schema.compute_invoice_total(subtotal)) STORED NOT NULL,
              CONSTRAINT invoice_totals_total_nonnegative CHECK (total >= 0)
            );

            CREATE UNIQUE INDEX invoice_totals_total_identity_idx
              ON test_schema.invoice_totals (total);

            ALTER TABLE test_schema.invoice_totals
              REPLICA IDENTITY USING INDEX invoice_totals_total_identity_idx;

            CREATE INDEX invoice_totals_total_idx
              ON test_schema.invoice_totals ((total + 1));

            ALTER TABLE test_schema.invoice_totals
              CLUSTER ON invoice_totals_total_idx;

            ALTER INDEX test_schema.invoice_totals_total_idx
              ALTER COLUMN 1 SET STATISTICS 100;

            COMMENT ON INDEX test_schema.invoice_totals_total_idx
              IS 'generated total lookup';

            CREATE VIEW test_schema.invoice_total_values AS
              SELECT id, total FROM test_schema.invoice_totals;

            CREATE TABLE test_schema.invoice_total_audit (
              invoice_id integer NOT NULL,
              total integer NOT NULL
            );

            CREATE FUNCTION test_schema.record_invoice_total_update()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $function$
            BEGIN
              INSERT INTO test_schema.invoice_total_audit (invoice_id, total)
              VALUES (NEW.id, NEW.total);
              RETURN NEW;
            END
            $function$;

            CREATE TRIGGER invoice_totals_total_trigger
              AFTER UPDATE OF total ON test_schema.invoice_totals
              FOR EACH ROW
              WHEN (OLD.total IS DISTINCT FROM NEW.total)
              EXECUTE FUNCTION test_schema.record_invoice_total_update();

            ALTER TABLE test_schema.invoice_totals
              DISABLE TRIGGER invoice_totals_total_trigger;

            CREATE TABLE test_schema.invoice_total_rule_audit (
              invoice_id integer NOT NULL,
              total integer NOT NULL
            );

            CREATE RULE invoice_totals_total_rule AS
              ON UPDATE TO test_schema.invoice_totals
              DO ALSO INSERT INTO test_schema.invoice_total_rule_audit
                (invoice_id, total)
                VALUES (NEW.id, NEW.total);

            ALTER TABLE test_schema.invoice_totals
              ENABLE REPLICA RULE invoice_totals_total_rule;

            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT FROM pg_catalog.pg_roles
                WHERE rolname = 'invoice_total_reader'
              ) THEN
                CREATE ROLE invoice_total_reader;
              END IF;
            END
            $$;

            GRANT SELECT (total)
              ON TABLE test_schema.invoice_totals TO invoice_total_reader;

            INSERT INTO test_schema.invoice_totals (id, subtotal)
            VALUES (1, 20);
          `,
          testSql: dedent`
            DROP VIEW test_schema.invoice_total_values;

            DROP TRIGGER invoice_totals_total_trigger
              ON test_schema.invoice_totals;

            DROP RULE invoice_totals_total_rule
              ON test_schema.invoice_totals;

            DROP INDEX test_schema.invoice_totals_total_idx;

            ALTER TABLE test_schema.invoice_totals
              REPLICA IDENTITY DEFAULT;

            DROP INDEX test_schema.invoice_totals_total_identity_idx;

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
                (test_schema.compute_invoice_total(subtotal)) STORED NOT NULL;

            ALTER TABLE test_schema.invoice_totals
              ADD CONSTRAINT invoice_totals_total_nonnegative CHECK (total >= 0);

            CREATE UNIQUE INDEX invoice_totals_total_identity_idx
              ON test_schema.invoice_totals (total);

            ALTER TABLE test_schema.invoice_totals
              REPLICA IDENTITY USING INDEX invoice_totals_total_identity_idx;

            CREATE INDEX invoice_totals_total_idx
              ON test_schema.invoice_totals ((total + 1));

            ALTER TABLE test_schema.invoice_totals
              CLUSTER ON invoice_totals_total_idx;

            ALTER INDEX test_schema.invoice_totals_total_idx
              ALTER COLUMN 1 SET STATISTICS 100;

            COMMENT ON INDEX test_schema.invoice_totals_total_idx
              IS 'generated total lookup';

            CREATE VIEW test_schema.invoice_total_values AS
              SELECT id, total FROM test_schema.invoice_totals;

            CREATE TRIGGER invoice_totals_total_trigger
              AFTER UPDATE OF total ON test_schema.invoice_totals
              FOR EACH ROW
              WHEN (OLD.total IS DISTINCT FROM NEW.total)
              EXECUTE FUNCTION test_schema.record_invoice_total_update();

            ALTER TABLE test_schema.invoice_totals
              DISABLE TRIGGER invoice_totals_total_trigger;

            CREATE RULE invoice_totals_total_rule AS
              ON UPDATE TO test_schema.invoice_totals
              DO ALSO INSERT INTO test_schema.invoice_total_rule_audit
                (invoice_id, total)
                VALUES (NEW.id, NEW.total);

            ALTER TABLE test_schema.invoice_totals
              ENABLE REPLICA RULE invoice_totals_total_rule;

            GRANT SELECT (total)
              ON TABLE test_schema.invoice_totals TO invoice_total_reader;
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
            const dropReplicaIdentityIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "DROP INDEX test_schema.invoice_totals_total_identity_idx",
                ),
            );
            const dropConstraintIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals DROP CONSTRAINT invoice_totals_total_nonnegative",
              ),
            );
            const dropTriggerIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP TRIGGER invoice_totals_total_trigger ON test_schema.invoice_totals",
              ),
            );
            const dropRuleIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP RULE invoice_totals_total_rule ON test_schema.invoice_totals",
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
            const createReplicaIdentityIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "CREATE UNIQUE INDEX invoice_totals_total_identity_idx ON test_schema.invoice_totals",
                ),
            );
            const restoreReplicaIdentityIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "ALTER TABLE test_schema.invoice_totals REPLICA IDENTITY USING INDEX invoice_totals_total_identity_idx",
                ),
            );
            const createIndexIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE INDEX invoice_totals_total_idx ON test_schema.invoice_totals",
              ),
            );
            const indexCommentIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "COMMENT ON INDEX test_schema.invoice_totals_total_idx",
              ),
            );
            const alterIndexStatisticsIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "ALTER INDEX test_schema.invoice_totals_total_idx ALTER COLUMN 1 SET STATISTICS 100",
                ),
            );
            const restoreClusterIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.invoice_totals CLUSTER ON invoice_totals_total_idx",
              ),
            );
            const createViewIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE VIEW test_schema.invoice_total_values",
              ),
            );
            const createTriggerIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE TRIGGER invoice_totals_total_trigger",
              ),
            );
            const restoreTriggerEnabledIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "ALTER TABLE test_schema.invoice_totals DISABLE TRIGGER invoice_totals_total_trigger",
                ),
            );
            const createRuleIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE RULE invoice_totals_total_rule"),
            );
            const restoreRuleEnabledIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "ALTER TABLE test_schema.invoice_totals ENABLE REPLICA RULE invoice_totals_total_rule",
                ),
            );
            const grantColumnIndex = sqlStatements.findIndex(
              (statement) =>
                statement.includes("SELECT (total)") &&
                statement.includes("test_schema.invoice_totals") &&
                statement.includes("invoice_total_reader"),
            );

            expect(dropViewIndex).toBeGreaterThanOrEqual(0);
            expect(dropIndexIndex).toBeGreaterThanOrEqual(0);
            expect(dropReplicaIdentityIndex).toBeGreaterThanOrEqual(0);
            expect(dropConstraintIndex).toBeGreaterThanOrEqual(0);
            expect(dropTriggerIndex).toBeGreaterThanOrEqual(0);
            expect(dropRuleIndex).toBeGreaterThanOrEqual(0);
            expect(dropColumnIndex).toBeGreaterThan(dropViewIndex);
            expect(dropColumnIndex).toBeGreaterThan(dropIndexIndex);
            expect(dropColumnIndex).toBeGreaterThan(dropReplicaIdentityIndex);
            expect(dropColumnIndex).toBeGreaterThan(dropConstraintIndex);
            expect(dropColumnIndex).toBeGreaterThan(dropTriggerIndex);
            expect(dropColumnIndex).toBeGreaterThan(dropRuleIndex);
            expect(dropFunctionIndex).toBeGreaterThan(dropColumnIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(addColumnIndex).toBeGreaterThan(createFunctionIndex);
            expect(addConstraintIndex).toBeGreaterThan(addColumnIndex);
            expect(createReplicaIdentityIndex).toBeGreaterThan(addColumnIndex);
            expect(restoreReplicaIdentityIndex).toBeGreaterThan(
              createReplicaIdentityIndex,
            );
            expect(createIndexIndex).toBeGreaterThan(addColumnIndex);
            expect(indexCommentIndex).toBeGreaterThan(createIndexIndex);
            expect(alterIndexStatisticsIndex).toBeGreaterThan(createIndexIndex);
            expect(restoreClusterIndex).toBeGreaterThan(createIndexIndex);
            expect(createViewIndex).toBeGreaterThan(addColumnIndex);
            expect(createTriggerIndex).toBeGreaterThan(addColumnIndex);
            expect(restoreTriggerEnabledIndex).toBeGreaterThan(
              createTriggerIndex,
            );
            expect(createRuleIndex).toBeGreaterThan(addColumnIndex);
            expect(restoreRuleEnabledIndex).toBeGreaterThan(createRuleIndex);
            expect(grantColumnIndex).toBeGreaterThan(addColumnIndex);
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
        const { rows: commentRows } = await db.main.query(dedent`
          SELECT obj_description(
            'test_schema.invoice_totals_total_idx'::regclass,
            'pg_class'
          ) AS comment
        `);
        expect(commentRows[0]?.comment).toBe("generated total lookup");
        const { rows: statisticsRows } = await db.main.query(dedent`
          SELECT attstattarget
          FROM pg_catalog.pg_attribute
          WHERE attrelid = 'test_schema.invoice_totals_total_idx'::regclass
            AND attnum = 1
        `);
        expect(statisticsRows[0]?.attstattarget).toBe(100);
        const { rows: clusterRows } = await db.main.query(dedent`
          SELECT i.indisclustered
          FROM pg_catalog.pg_index i
          JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace
          WHERE n.nspname = 'test_schema'
            AND idx.relname = 'invoice_totals_total_idx'
        `);
        expect(clusterRows[0]?.indisclustered).toBe(true);
        const { rows: replicaIdentityRows } = await db.main.query(dedent`
                      SELECT c.relreplident, i.indisreplident
                      FROM pg_catalog.pg_class c
                      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                      JOIN pg_catalog.pg_index i ON i.indrelid = c.oid
                      JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
                      WHERE n.nspname = 'test_schema'
                        AND c.relname = 'invoice_totals'
                        AND idx.relname = 'invoice_totals_total_identity_idx'
                    `);
        expect(replicaIdentityRows[0]).toMatchObject({
          relreplident: "i",
          indisreplident: true,
        });
        const { rows: triggerRows } = await db.main.query(dedent`
	                      SELECT pg_get_triggerdef(oid) AS definition, tgenabled
	                      FROM pg_catalog.pg_trigger
	                      WHERE tgname = 'invoice_totals_total_trigger'
	                        AND NOT tgisinternal
	                    `);
        expect(triggerRows[0]?.definition).toContain("UPDATE OF total");
        expect(triggerRows[0]?.tgenabled).toBe("D");
        const { rows: ruleRows } = await db.main.query(dedent`
	                      SELECT pg_get_ruledef(r.oid) AS definition, r.ev_enabled
	                      FROM pg_catalog.pg_rewrite r
	                      JOIN pg_catalog.pg_class c ON c.oid = r.ev_class
                      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                      WHERE r.rulename = 'invoice_totals_total_rule'
                        AND n.nspname = 'test_schema'
                        AND c.relname = 'invoice_totals'
	        `);
        expect(ruleRows[0]?.definition).toContain("new.total");
        expect(ruleRows[0]?.ev_enabled).toBe("R");
        const { rows: privilegeRows } = await db.main.query(dedent`
          SELECT has_column_privilege(
            'invoice_total_reader',
            'test_schema.invoice_totals',
            'total',
            'SELECT'
          ) AS has_privilege
        `);
        expect(privilegeRows[0]?.has_privilege).toBe(true);
      }),
    );

    test.skipIf(pgVersion < 18)(
      "unchanged generated column in publication column list does not recreate table",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
	            CREATE SCHEMA test_schema;

	            CREATE FUNCTION test_schema.compute_publication_total(value integer)
	            RETURNS integer
	            LANGUAGE sql
	            IMMUTABLE
	            AS $function$
	              SELECT value + 1
	            $function$;

	            CREATE TABLE test_schema.published_invoice_totals (
	              id integer NOT NULL,
	              subtotal integer NOT NULL,
	              total integer GENERATED ALWAYS AS
	                (test_schema.compute_publication_total(subtotal)) STORED
	            );

	            CREATE PUBLICATION invoice_total_pub
	              FOR TABLE test_schema.published_invoice_totals (id, total);

	            INSERT INTO test_schema.published_invoice_totals (id, subtotal)
	            VALUES (1, 20);
	          `,
          testSql: dedent`
	            ALTER PUBLICATION invoice_total_pub
	              SET TABLE test_schema.published_invoice_totals (id);

	            ALTER TABLE test_schema.published_invoice_totals
	              DROP COLUMN total;

	            DROP FUNCTION test_schema.compute_publication_total(integer);

	            CREATE FUNCTION test_schema.compute_publication_total(input integer)
	            RETURNS integer
	            LANGUAGE sql
	            IMMUTABLE
	            AS $function$
	              SELECT input + 1
	            $function$;

	            ALTER TABLE test_schema.published_invoice_totals
	              ADD COLUMN total integer GENERATED ALWAYS AS
	                (test_schema.compute_publication_total(subtotal)) STORED;

	            ALTER PUBLICATION invoice_total_pub
	              SET TABLE test_schema.published_invoice_totals (id, total);
	          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const publicationDropStatements = sqlStatements.filter(
              (statement) =>
                statement.startsWith(
                  "ALTER PUBLICATION invoice_total_pub DROP TABLE",
                ),
            );
            const publicationAddStatements = sqlStatements.filter((statement) =>
              statement.startsWith(
                "ALTER PUBLICATION invoice_total_pub ADD TABLE",
              ),
            );
            const releasePublicationIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "ALTER PUBLICATION invoice_total_pub DROP TABLE test_schema.published_invoice_totals",
                ),
            );
            const dropColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.published_invoice_totals DROP COLUMN total",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.compute_publication_total",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.compute_publication_total",
              ),
            );
            const addColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.published_invoice_totals ADD COLUMN total",
              ),
            );
            const restorePublicationIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "ALTER PUBLICATION invoice_total_pub ADD TABLE test_schema.published_invoice_totals (id, total)",
                ),
            );

            expect(publicationDropStatements).toHaveLength(1);
            expect(publicationAddStatements).toHaveLength(1);
            expect(releasePublicationIndex).toBeGreaterThanOrEqual(0);
            expect(dropColumnIndex).toBeGreaterThan(releasePublicationIndex);
            expect(dropFunctionIndex).toBeGreaterThan(dropColumnIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(addColumnIndex).toBeGreaterThan(createFunctionIndex);
            expect(restorePublicationIndex).toBeGreaterThan(addColumnIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.published_invoice_totals",
          1,
        );
        const { rows: publicationRows } = await db.main.query(dedent`
	          SELECT json_agg(att.attname ORDER BY cols.ord) AS columns
	          FROM pg_catalog.pg_publication p
	          JOIN pg_catalog.pg_publication_rel pr ON pr.prpubid = p.oid
	          JOIN pg_catalog.pg_class c ON c.oid = pr.prrelid
	          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
	          JOIN unnest(pr.prattrs) WITH ORDINALITY AS cols(attnum, ord)
	            ON true
	          JOIN pg_catalog.pg_attribute att
	            ON att.attrelid = c.oid
	           AND att.attnum = cols.attnum
	          WHERE p.pubname = 'invoice_total_pub'
	            AND n.nspname = 'test_schema'
	            AND c.relname = 'published_invoice_totals'
	        `);
        expect(publicationRows[0]?.columns).toEqual(["id", "total"]);
      }),
    );

    test.skipIf(pgVersion < 18)(
      "multiple generated publication column lists are refreshed independently",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_shared_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.published_invoice_totals (
              id integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_shared_total(subtotal)) STORED
            );

            CREATE TABLE test_schema.published_order_totals (
              id integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_shared_total(subtotal)) STORED
            );

            CREATE PUBLICATION shared_total_pub
              FOR TABLE test_schema.published_invoice_totals (id, total),
                        test_schema.published_order_totals (id, total);

            INSERT INTO test_schema.published_invoice_totals (id, subtotal)
            VALUES (1, 20);
            INSERT INTO test_schema.published_order_totals (id, subtotal)
            VALUES (1, 30);
          `,
          testSql: dedent`
            ALTER PUBLICATION shared_total_pub
              SET TABLE test_schema.published_invoice_totals (id),
                        test_schema.published_order_totals (id);

            ALTER TABLE test_schema.published_invoice_totals
              DROP COLUMN total;
            ALTER TABLE test_schema.published_order_totals
              DROP COLUMN total;

            DROP FUNCTION test_schema.compute_shared_total(integer);

            CREATE FUNCTION test_schema.compute_shared_total(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            ALTER TABLE test_schema.published_invoice_totals
              ADD COLUMN total integer GENERATED ALWAYS AS
                (test_schema.compute_shared_total(subtotal)) STORED;
            ALTER TABLE test_schema.published_order_totals
              ADD COLUMN total integer GENERATED ALWAYS AS
                (test_schema.compute_shared_total(subtotal)) STORED;

            ALTER PUBLICATION shared_total_pub
              SET TABLE test_schema.published_invoice_totals (id, total),
                        test_schema.published_order_totals (id, total);
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const publicationDropStatements = sqlStatements.filter(
              (statement) =>
                statement.startsWith(
                  "ALTER PUBLICATION shared_total_pub DROP TABLE",
                ),
            );
            const publicationAddStatements = sqlStatements.filter((statement) =>
              statement.startsWith(
                "ALTER PUBLICATION shared_total_pub ADD TABLE",
              ),
            );

            expect(publicationDropStatements).toHaveLength(1);
            expect(publicationAddStatements).toHaveLength(1);
            expect(publicationDropStatements).toContain(
              "ALTER PUBLICATION shared_total_pub DROP TABLE test_schema.published_invoice_totals, test_schema.published_order_totals",
            );
            expect(publicationAddStatements).toContain(
              "ALTER PUBLICATION shared_total_pub ADD TABLE test_schema.published_invoice_totals (id, total), TABLE test_schema.published_order_totals (id, total)",
            );
          },
        });

        for (const tableName of [
          "published_invoice_totals",
          "published_order_totals",
        ]) {
          const { rows } = await db.main.query(dedent`
            SELECT json_agg(att.attname ORDER BY cols.ord) AS columns
            FROM pg_catalog.pg_publication p
            JOIN pg_catalog.pg_publication_rel pr ON pr.prpubid = p.oid
            JOIN pg_catalog.pg_class c ON c.oid = pr.prrelid
            JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            JOIN unnest(pr.prattrs) WITH ORDINALITY AS cols(attnum, ord)
              ON true
            JOIN pg_catalog.pg_attribute att
              ON att.attrelid = c.oid
             AND att.attnum = cols.attnum
            WHERE p.pubname = 'shared_total_pub'
              AND n.nspname = 'test_schema'
              AND c.relname = '${tableName}'
          `);
          expect(rows[0]?.columns).toEqual(["id", "total"]);
        }
      }),
    );

    test(
      "clustered materialized view indexes survive dependent function replacement",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_mv_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.mv_inputs (
              id integer NOT NULL,
              subtotal integer NOT NULL
            );

            CREATE MATERIALIZED VIEW test_schema.invoice_total_mv AS
              SELECT
                id,
                test_schema.compute_mv_total(subtotal) AS total
              FROM test_schema.mv_inputs;

            CREATE INDEX invoice_total_mv_total_idx
              ON test_schema.invoice_total_mv (total);

            ALTER MATERIALIZED VIEW test_schema.invoice_total_mv
              CLUSTER ON invoice_total_mv_total_idx;

            INSERT INTO test_schema.mv_inputs (id, subtotal)
            VALUES (1, 20);
          `,
          testSql: dedent`
            DROP INDEX test_schema.invoice_total_mv_total_idx;

            DROP MATERIALIZED VIEW test_schema.invoice_total_mv;

            DROP FUNCTION test_schema.compute_mv_total(integer);

            CREATE FUNCTION test_schema.compute_mv_total(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            CREATE MATERIALIZED VIEW test_schema.invoice_total_mv AS
              SELECT
                id,
                test_schema.compute_mv_total(subtotal) AS total
              FROM test_schema.mv_inputs;

            CREATE INDEX invoice_total_mv_total_idx
              ON test_schema.invoice_total_mv (total);

            ALTER MATERIALIZED VIEW test_schema.invoice_total_mv
              CLUSTER ON invoice_total_mv_total_idx;
          `,
          assertSqlStatements: (sqlStatements) => {
            const dropIndexIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP INDEX test_schema.invoice_total_mv_total_idx",
              ),
            );
            const dropMaterializedViewIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "DROP MATERIALIZED VIEW test_schema.invoice_total_mv",
                ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.compute_mv_total",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.compute_mv_total",
              ),
            );
            const createMaterializedViewIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith(
                  "CREATE MATERIALIZED VIEW test_schema.invoice_total_mv",
                ),
            );
            const createIndexIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE INDEX invoice_total_mv_total_idx ON test_schema.invoice_total_mv",
              ),
            );
            const restoreClusterIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER MATERIALIZED VIEW test_schema.invoice_total_mv CLUSTER ON invoice_total_mv_total_idx",
              ),
            );

            expect(dropMaterializedViewIndex).toBeGreaterThanOrEqual(0);
            if (dropIndexIndex >= 0) {
              expect(dropMaterializedViewIndex).toBeGreaterThan(dropIndexIndex);
            }
            expect(dropFunctionIndex).toBeGreaterThan(
              dropMaterializedViewIndex,
            );
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(createMaterializedViewIndex).toBeGreaterThan(
              createFunctionIndex,
            );
            expect(createIndexIndex).toBeGreaterThan(
              createMaterializedViewIndex,
            );
            expect(restoreClusterIndex).toBeGreaterThan(createIndexIndex);
          },
        });

        const { rows } = await db.main.query(dedent`
          SELECT i.indisclustered
          FROM pg_catalog.pg_index i
          JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid
          JOIN pg_catalog.pg_namespace n ON n.oid = idx.relnamespace
          WHERE n.nspname = 'test_schema'
            AND idx.relname = 'invoice_total_mv_total_idx'
        `);
        expect(rows[0]?.indisclustered).toBe(true);
      }),
    );

    test(
      "aggregate dependents are recreated before replacing support functions",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.sum_state(state integer, value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT state + value
            $function$;

            CREATE AGGREGATE test_schema.total_amount(integer) (
              SFUNC = test_schema.sum_state,
              STYPE = integer,
              INITCOND = '0'
            );

            CREATE TABLE test_schema.aggregate_inputs (
              value integer NOT NULL
            );

            INSERT INTO test_schema.aggregate_inputs (value)
            VALUES (1), (2);
          `,
          testSql: dedent`
            DROP AGGREGATE test_schema.total_amount(integer);

            DROP FUNCTION test_schema.sum_state(integer, integer);

            CREATE FUNCTION test_schema.sum_state(current_total integer, input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT current_total + input
            $function$;

            CREATE AGGREGATE test_schema.total_amount(integer) (
              SFUNC = test_schema.sum_state,
              STYPE = integer,
              INITCOND = '0'
            );
          `,
          assertSqlStatements: (sqlStatements) => {
            const dropAggregateIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP AGGREGATE test_schema.total_amount"),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.sum_state"),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE FUNCTION test_schema.sum_state"),
            );
            const createAggregateIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE AGGREGATE test_schema.total_amount"),
            );

            expect(dropAggregateIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropAggregateIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(createAggregateIndex).toBeGreaterThan(createFunctionIndex);
          },
        });

        const { rows } = await db.main.query(dedent`
          SELECT test_schema.total_amount(value) AS total
          FROM test_schema.aggregate_inputs
        `);
        expect(rows[0]?.total).toBe(3);
      }),
    );

    test(
      "unchanged generated partition column for replaced function argument name does not emit child DDL",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_partition_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.partitioned_invoice_totals (
              id integer NOT NULL,
              period integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_partition_total(subtotal)) STORED,
              CONSTRAINT partitioned_invoice_totals_total_nonnegative
                CHECK (total >= 0)
            ) PARTITION BY RANGE (period);

            CREATE TABLE test_schema.partitioned_invoice_totals_2026
              PARTITION OF test_schema.partitioned_invoice_totals
              FOR VALUES FROM (2026) TO (2027);

            INSERT INTO test_schema.partitioned_invoice_totals
              (id, period, subtotal)
            VALUES (1, 2026, 20);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.partitioned_invoice_totals
              DROP CONSTRAINT partitioned_invoice_totals_total_nonnegative;

            ALTER TABLE test_schema.partitioned_invoice_totals
              DROP COLUMN total;

            DROP FUNCTION test_schema.compute_partition_total(integer);

            CREATE FUNCTION test_schema.compute_partition_total(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            ALTER TABLE test_schema.partitioned_invoice_totals
              ADD COLUMN total integer GENERATED ALWAYS AS
                (test_schema.compute_partition_total(subtotal)) STORED;

            ALTER TABLE test_schema.partitioned_invoice_totals
              ADD CONSTRAINT partitioned_invoice_totals_total_nonnegative
              CHECK (total >= 0);
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            expect(
              sqlStatements.some((statement) =>
                statement.startsWith(
                  "ALTER TABLE test_schema.partitioned_invoice_totals_2026 DROP COLUMN total",
                ),
              ),
            ).toBe(false);
            expect(
              sqlStatements.some((statement) =>
                statement.startsWith(
                  "ALTER TABLE test_schema.partitioned_invoice_totals_2026 DROP CONSTRAINT partitioned_invoice_totals_total_nonnegative",
                ),
              ),
            ).toBe(false);
            expect(
              sqlStatements.some((statement) =>
                statement.startsWith(
                  "ALTER TABLE test_schema.partitioned_invoice_totals_2026 ADD CONSTRAINT partitioned_invoice_totals_total_nonnegative",
                ),
              ),
            ).toBe(false);

            const parentDropColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.partitioned_invoice_totals DROP COLUMN total",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.compute_partition_total",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.compute_partition_total",
              ),
            );
            const parentAddColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.partitioned_invoice_totals ADD COLUMN total",
              ),
            );

            expect(parentDropColumnIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(parentDropColumnIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(parentAddColumnIndex).toBeGreaterThan(createFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.partitioned_invoice_totals",
          1,
        );
      }),
    );

    test(
      "local partition column default for replaced function argument name is released on the child",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.default_partition_score(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.partitioned_scores (
              id integer NOT NULL,
              period integer NOT NULL,
              score integer
            ) PARTITION BY RANGE (period);

            CREATE TABLE test_schema.partitioned_scores_2026
              PARTITION OF test_schema.partitioned_scores
              FOR VALUES FROM (2026) TO (2027);

            ALTER TABLE test_schema.partitioned_scores_2026
              ALTER COLUMN score
              SET DEFAULT test_schema.default_partition_score(1);

            INSERT INTO test_schema.partitioned_scores (id, period)
            VALUES (1, 2026);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.partitioned_scores_2026
              ALTER COLUMN score DROP DEFAULT;

            DROP FUNCTION test_schema.default_partition_score(integer);

            CREATE FUNCTION test_schema.default_partition_score(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            ALTER TABLE test_schema.partitioned_scores_2026
              ALTER COLUMN score
              SET DEFAULT test_schema.default_partition_score(1);
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropDefaultIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.partitioned_scores_2026 ALTER COLUMN score DROP DEFAULT",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.default_partition_score",
              ),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.default_partition_score",
              ),
            );
            const restoreDefaultIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.partitioned_scores_2026 ALTER COLUMN score SET DEFAULT",
              ),
            );

            expect(dropDefaultIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropDefaultIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(restoreDefaultIndex).toBeGreaterThan(createFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.partitioned_scores",
          1,
        );
      }),
    );

    test(
      "removed generated partition column for dropped function does not emit child DDL",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.compute_archived_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE test_schema.partitioned_archive_totals (
              id integer NOT NULL,
              period integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (test_schema.compute_archived_total(subtotal)) STORED
            ) PARTITION BY RANGE (period);

            CREATE TABLE test_schema.partitioned_archive_totals_2026
              PARTITION OF test_schema.partitioned_archive_totals
              FOR VALUES FROM (2026) TO (2027);

            INSERT INTO test_schema.partitioned_archive_totals
              (id, period, subtotal)
            VALUES (1, 2026, 20);
          `,
          testSql: dedent`
            ALTER TABLE test_schema.partitioned_archive_totals
              DROP COLUMN total;

            DROP FUNCTION test_schema.compute_archived_total(integer);
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            expect(
              sqlStatements.some((statement) =>
                statement.startsWith(
                  "ALTER TABLE test_schema.partitioned_archive_totals_2026 DROP COLUMN total",
                ),
              ),
            ).toBe(false);

            const parentDropColumnIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "ALTER TABLE test_schema.partitioned_archive_totals DROP COLUMN total",
              ),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "DROP FUNCTION test_schema.compute_archived_total",
              ),
            );

            expect(parentDropColumnIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(parentDropColumnIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.partitioned_archive_totals",
          1,
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

    test(
      "rebuilt view for overloaded replacement drops old function before restore",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.score_label(value integer)
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT 'old:' || value::text
            $function$;

            CREATE TABLE test_schema.score_labels (
              id integer NOT NULL,
              value integer NOT NULL
            );

            CREATE VIEW test_schema.score_label_view AS
              SELECT id, test_schema.score_label(value) AS label
              FROM test_schema.score_labels;

            INSERT INTO test_schema.score_labels (id, value)
            VALUES (1, 10);
          `,
          testSql: dedent`
            DROP VIEW test_schema.score_label_view;

            CREATE FUNCTION test_schema.score_label(value bigint)
            RETURNS text
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT 'new:' || value::text
            $function$;

            DROP FUNCTION test_schema.score_label(integer);

            CREATE VIEW test_schema.score_label_view AS
              SELECT id, test_schema.score_label(value) AS label
              FROM test_schema.score_labels;
          `,
          assertSqlStatements: (sqlStatements) => {
            expectNoTableReplacement(sqlStatements);

            const dropViewIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP VIEW test_schema.score_label_view"),
            );
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.score_label"),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("CREATE FUNCTION test_schema.score_label"),
            );
            const createViewIndex = sqlStatements.findIndex(
              (statement) =>
                statement.startsWith("CREATE") &&
                statement.includes("VIEW test_schema.score_label_view"),
            );

            expect(dropViewIndex).toBeGreaterThanOrEqual(0);
            expect(dropFunctionIndex).toBeGreaterThan(dropViewIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
            expect(createViewIndex).toBeGreaterThan(createFunctionIndex);
          },
        });

        await expectTableRowCount(
          db.main.query.bind(db.main),
          "test_schema.score_labels",
          1,
        );
      }),
    );

    test(
      "defaulted old overload drops before shorter replacement is created",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE FUNCTION test_schema.normalize_score(
              value integer,
              scale integer DEFAULT 1
            )
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value * scale
            $function$;
          `,
          testSql: dedent`
            DROP FUNCTION test_schema.normalize_score(integer, integer);

            CREATE FUNCTION test_schema.normalize_score(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;
          `,
          assertSqlStatements: (sqlStatements) => {
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.normalize_score"),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.normalize_score",
              ),
            );

            expect(dropFunctionIndex).toBeGreaterThanOrEqual(0);
            expect(createFunctionIndex).toBeGreaterThan(dropFunctionIndex);
          },
        });
      }),
    );

    test(
      "old argument domain drops after the old overloaded function",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE DOMAIN test_schema.old_score AS integer;

            CREATE FUNCTION test_schema.normalize_score(value test_schema.old_score)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value::integer
            $function$;
          `,
          testSql: dedent`
            DROP FUNCTION test_schema.normalize_score(test_schema.old_score);
            DROP DOMAIN test_schema.old_score;

            CREATE FUNCTION test_schema.normalize_score(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;
          `,
          assertSqlStatements: (sqlStatements) => {
            const dropFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP FUNCTION test_schema.normalize_score"),
            );
            const dropDomainIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith("DROP DOMAIN test_schema.old_score"),
            );
            const createFunctionIndex = sqlStatements.findIndex((statement) =>
              statement.startsWith(
                "CREATE FUNCTION test_schema.normalize_score",
              ),
            );

            expect(dropFunctionIndex).toBeGreaterThanOrEqual(0);
            expect(dropDomainIndex).toBeGreaterThan(dropFunctionIndex);
            expect(createFunctionIndex).toBeGreaterThan(dropDomainIndex);
          },
        });
      }),
    );
  });
}
