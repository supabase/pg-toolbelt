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
  });
}
