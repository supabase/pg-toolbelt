/**
 * Integration tests for PostgreSQL materialized view operations.
 */

import { describe, test } from "bun:test";
import dedent from "dedent";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`materialized view operations (pg${pgVersion})`, () => {
    test(
      "create new materialized view",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL,
            email text,
            active boolean DEFAULT true
          );
        `,
          testSql: dedent`
          CREATE MATERIALIZED VIEW test_schema.active_users AS
          SELECT id, name, email
          FROM test_schema.users
          WHERE active = true
          WITH NO DATA;
        `,
        });
      }),
    );

    test(
      "drop existing materialized view",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL,
            active boolean DEFAULT true
          );

          CREATE MATERIALIZED VIEW test_schema.active_users AS
          SELECT id, name
          FROM test_schema.users
          WHERE active = true
          WITH NO DATA;
        `,
          testSql: `
          DROP MATERIALIZED VIEW test_schema.active_users;
        `,
        });
      }),
    );

    test(
      "replace materialized view definition",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text NOT NULL,
            email text,
            active boolean DEFAULT true
          );

          CREATE MATERIALIZED VIEW test_schema.user_summary AS
          SELECT id, name
          FROM test_schema.users
          WHERE active = true
          WITH NO DATA;
        `,
          testSql: dedent`
          DROP MATERIALIZED VIEW test_schema.user_summary;
          CREATE MATERIALIZED VIEW test_schema.user_summary AS
          SELECT id, name, email
          FROM test_schema.users
          WHERE active = true
          ORDER BY name
          WITH NO DATA;
        `,
        });
      }),
    );

    test(
      "replace materialized view with dependent index and view",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: dedent`
            CREATE SCHEMA test_schema;

            CREATE TABLE test_schema.orders (
              id serial PRIMARY KEY,
              customer text NOT NULL,
              total numeric NOT NULL,
              created_at timestamptz DEFAULT now()
            );

            CREATE MATERIALIZED VIEW test_schema.order_summary AS
              SELECT customer, sum(total) AS total_spent, count(*) AS order_count
              FROM test_schema.orders
              GROUP BY customer;

            CREATE UNIQUE INDEX order_summary_customer_idx
              ON test_schema.order_summary (customer);

            CREATE VIEW test_schema.top_customers AS
              SELECT * FROM test_schema.order_summary
              WHERE total_spent > 1000;
          `,
          testSql: dedent`
            DROP VIEW test_schema.top_customers;
            DROP INDEX test_schema.order_summary_customer_idx;
            DROP MATERIALIZED VIEW test_schema.order_summary;

            CREATE MATERIALIZED VIEW test_schema.order_summary AS
              SELECT customer,
                     sum(total) AS total_spent,
                     count(*) AS order_count,
                     max(created_at) AS last_order
              FROM test_schema.orders
              GROUP BY customer;

            CREATE UNIQUE INDEX order_summary_customer_idx
              ON test_schema.order_summary (customer);

            CREATE VIEW test_schema.top_customers AS
              SELECT * FROM test_schema.order_summary
              WHERE total_spent > 1000;
          `,
          expectedSqlTerms: [
            "DROP INDEX test_schema.order_summary_customer_idx",
            "DROP VIEW test_schema.top_customers",
            "DROP MATERIALIZED VIEW test_schema.order_summary",
            dedent`
              CREATE MATERIALIZED VIEW test_schema.order_summary AS SELECT customer,
                  sum(total) AS total_spent,
                  count(*) AS order_count,
                  max(created_at) AS last_order
                 FROM test_schema.orders
                GROUP BY customer WITH DATA
            `,
            "CREATE UNIQUE INDEX order_summary_customer_idx ON test_schema.order_summary (customer)",
            dedent`
              CREATE OR REPLACE VIEW test_schema.top_customers AS SELECT customer,
                  total_spent,
                  order_count,
                  last_order
                 FROM test_schema.order_summary
                WHERE (total_spent > (1000)::numeric)
            `,
          ],
        });
      }),
    );

    test(
      "materialized view with aggregations",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA analytics;
          CREATE TABLE analytics.sales (
            id integer PRIMARY KEY,
            customer_id integer,
            amount decimal(10,2),
            sale_date date
          );
        `,
          testSql: dedent`
          CREATE MATERIALIZED VIEW analytics.monthly_sales AS
          SELECT
            DATE_TRUNC('month', sale_date) as month,
            COUNT(*) as total_sales,
            SUM(amount) as total_revenue
          FROM analytics.sales
          GROUP BY DATE_TRUNC('month', sale_date)
          ORDER BY month
          WITH NO DATA;
        `,
        });
      }),
    );

    test(
      "materialized view with joins",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA ecommerce;
          CREATE TABLE ecommerce.customers (
            id integer PRIMARY KEY,
            name text NOT NULL
          );

          CREATE TABLE ecommerce.orders (
            id integer PRIMARY KEY,
            customer_id integer,
            total decimal(10,2)
          );
        `,
          testSql: `
          CREATE MATERIALIZED VIEW ecommerce.customer_orders AS
          SELECT
            c.id as customer_id,
            c.name,
            COUNT(o.id) as order_count,
            COALESCE(SUM(o.total), 0) as total_spent
          FROM ecommerce.customers c
          LEFT JOIN ecommerce.orders o ON c.id = o.customer_id
          GROUP BY c.id, c.name
          WITH NO DATA;
        `,
        });
      }),
    );

    test(
      "materialized view comments",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer PRIMARY KEY,
            name text
          );
          CREATE MATERIALIZED VIEW test_schema.user_names AS
          SELECT id, name FROM test_schema.users WITH NO DATA;
        `,
          testSql: `
          COMMENT ON MATERIALIZED VIEW test_schema.user_names IS 'user names matview';
        `,
        });
      }),
    );
  });
}
