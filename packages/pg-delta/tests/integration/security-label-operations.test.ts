import { describe, expect, test } from "bun:test";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { shouldSkipDummySeclabelBuild } from "../postgres-alpine.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

/**
 * Security-label integration tests use PostgreSQL's `dummy_seclabel` contrib
 * module, which registers the "dummy" provider. It ships with both the
 * official alpine images and the Supabase PostgreSQL images used in CI.
 *
 * When the sandbox escape hatch (`PGDELTA_SKIP_DUMMY_SECLABEL_BUILD`) is set,
 * `buildPostgresTestImage` falls back to the stock postgres-alpine image,
 * which does not ship dummy_seclabel — so this whole file skips. Coverage
 * is preserved in CI, where the prebuilt `pg-delta-test:*` image is used.
 */
const DUMMY_PROVIDER_SETUP = `CREATE EXTENSION IF NOT EXISTS dummy_seclabel;`;

const SKIP_SECLABEL_TESTS = shouldSkipDummySeclabelBuild();

for (const pgVersion of POSTGRES_VERSIONS) {
  describe.skipIf(SKIP_SECLABEL_TESTS)(
    `security labels on tables and columns (pg${pgVersion})`,
    () => {
      test(
        "label on new table",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: DUMMY_PROVIDER_SETUP,
            testSql: `
            CREATE TABLE public.t1 (id integer PRIMARY KEY);
            SECURITY LABEL FOR dummy ON TABLE public.t1 IS 'classified';
          `,
          });
        }),
      );

      test(
        "label on column",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE TABLE public.t1 (id integer PRIMARY KEY, email text);
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON COLUMN public.t1.email IS 'classified';
          `,
          });
        }),
      );

      test(
        "change table + column labels together",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE TABLE public.t1 (id integer PRIMARY KEY, email text);
            SECURITY LABEL FOR dummy ON TABLE public.t1 IS 'secret';
            SECURITY LABEL FOR dummy ON COLUMN public.t1.email IS 'secret';
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON TABLE public.t1 IS 'classified';
            SECURITY LABEL FOR dummy ON COLUMN public.t1.email IS 'unclassified';
          `,
          });
        }),
      );

      test(
        "drop column label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE TABLE public.t1 (id integer PRIMARY KEY, email text);
            SECURITY LABEL FOR dummy ON COLUMN public.t1.email IS 'secret';
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON COLUMN public.t1.email IS NULL;
          `,
          });
        }),
      );

      test(
        "retained label on recreated generated column",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE FUNCTION public.compute_total(value integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT value + 1
            $function$;

            CREATE TABLE public.invoices (
              id integer NOT NULL,
              subtotal integer NOT NULL,
              total integer GENERATED ALWAYS AS
                (public.compute_total(subtotal)) STORED
            );

            SECURITY LABEL FOR dummy ON COLUMN public.invoices.total
              IS 'classified';
          `,
            testSql: `
            ALTER TABLE public.invoices DROP COLUMN total;

            DROP FUNCTION public.compute_total(integer);

            CREATE FUNCTION public.compute_total(input integer)
            RETURNS integer
            LANGUAGE sql
            IMMUTABLE
            AS $function$
              SELECT input + 1
            $function$;

            ALTER TABLE public.invoices
              ADD COLUMN total integer GENERATED ALWAYS AS
                (public.compute_total(subtotal)) STORED;

            SECURITY LABEL FOR dummy ON COLUMN public.invoices.total
              IS 'classified';
          `,
            assertSqlStatements: (sqlStatements) => {
              expect(
                sqlStatements.some((statement) =>
                  statement.startsWith("DROP TABLE "),
                ),
              ).toBe(false);
              expect(
                sqlStatements.some((statement) =>
                  statement.startsWith("CREATE TABLE "),
                ),
              ).toBe(false);

              const addColumnIndex = sqlStatements.findIndex((statement) =>
                statement.startsWith(
                  "ALTER TABLE public.invoices ADD COLUMN total",
                ),
              );
              const securityLabelIndex = sqlStatements.findIndex((statement) =>
                statement.startsWith(
                  "SECURITY LABEL FOR dummy ON COLUMN public.invoices.total",
                ),
              );

              expect(addColumnIndex).toBeGreaterThanOrEqual(0);
              expect(securityLabelIndex).toBeGreaterThan(addColumnIndex);
            },
          });
        }),
      );
    },
  );

  describe.skipIf(SKIP_SECLABEL_TESTS)(
    `security labels on other object types (pg${pgVersion})`,
    () => {
      test(
        "view label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE TABLE public.base (id integer);
            CREATE VIEW public.v AS SELECT id FROM public.base;
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON VIEW public.v IS 'classified';
          `,
          });
        }),
      );

      test(
        "materialized view label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE TABLE public.base (id integer);
            CREATE MATERIALIZED VIEW public.mv AS SELECT id FROM public.base;
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON MATERIALIZED VIEW public.mv IS 'classified';
          `,
          });
        }),
      );

      test(
        "sequence label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE SEQUENCE public.s1;
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON SEQUENCE public.s1 IS 'classified';
          `,
          });
        }),
      );

      test(
        "domain label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE DOMAIN public.non_empty_text AS text CHECK (VALUE <> '');
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON DOMAIN public.non_empty_text IS 'classified';
          `,
          });
        }),
      );

      test(
        "enum (TYPE) label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE TYPE public.status AS ENUM ('active', 'inactive');
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON TYPE public.status IS 'classified';
          `,
          });
        }),
      );

      test(
        "composite TYPE label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE TYPE public.full_name AS (first text, last text);
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON TYPE public.full_name IS 'classified';
          `,
          });
        }),
      );

      test(
        "function label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE FUNCTION public.noop() RETURNS integer AS $$ SELECT 1 $$ LANGUAGE sql;
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON FUNCTION public.noop() IS 'classified';
          `,
          });
        }),
      );

      test(
        "role label (shared catalog)",
        withDbIsolated(pgVersion, async (db) => {
          // Roles and role security labels are cluster-wide, so this test needs
          // full container isolation instead of withDb's database-only isolation.
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1 FROM pg_roles WHERE rolname = 'test_role_with_label'
              ) THEN
                CREATE ROLE test_role_with_label;
              END IF;
            END
            $$;
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON ROLE test_role_with_label IS 'classified';
          `,
            expectedSqlTerms: [
              "SECURITY LABEL FOR dummy ON ROLE test_role_with_label IS 'classified'",
            ],
          });
        }),
      );
    },
  );

  describe.skipIf(SKIP_SECLABEL_TESTS)(
    `security labels on schemas (pg${pgVersion})`,
    () => {
      test(
        "add label to new schema",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: DUMMY_PROVIDER_SETUP,
            testSql: `
            CREATE SCHEMA labeled;
            SECURITY LABEL FOR dummy ON SCHEMA labeled IS 'classified';
          `,
          });
        }),
      );

      test(
        "add label to existing schema",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE SCHEMA labeled;
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON SCHEMA labeled IS 'classified';
          `,
          });
        }),
      );

      test(
        "change label value",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE SCHEMA labeled;
            SECURITY LABEL FOR dummy ON SCHEMA labeled IS 'secret';
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON SCHEMA labeled IS 'classified';
          `,
          });
        }),
      );

      test(
        "drop label",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
            ${DUMMY_PROVIDER_SETUP}
            CREATE SCHEMA labeled;
            SECURITY LABEL FOR dummy ON SCHEMA labeled IS 'secret';
          `,
            testSql: `
            SECURITY LABEL FOR dummy ON SCHEMA labeled IS NULL;
          `,
          });
        }),
      );
    },
  );
}
