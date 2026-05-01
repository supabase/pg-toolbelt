import { describe, test } from "bun:test";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

/**
 * Security-label integration tests use PostgreSQL's `dummy_seclabel` contrib
 * module, which registers the "dummy" provider. It ships with both the
 * official alpine images and the Supabase PostgreSQL images used in CI.
 */
const DUMMY_PROVIDER_SETUP = `CREATE EXTENSION IF NOT EXISTS dummy_seclabel;`;

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`security labels on tables and columns (pg${pgVersion})`, () => {
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
  });

  describe(`security labels on other object types (pg${pgVersion})`, () => {
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
      withDb(pgVersion, async (db) => {
        // Roles are cluster-wide; use DO/IF-NOT-EXISTS so the setup is
        // idempotent across tests that share a container.
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
        });
      }),
    );
  });

  describe(`security labels on schemas (pg${pgVersion})`, () => {
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
  });
}
