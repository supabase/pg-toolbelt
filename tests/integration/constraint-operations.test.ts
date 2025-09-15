/**
 * Integration tests for PostgreSQL constraint operations.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);

  // TODO: Fix constraint dependency detection issues - many complex dependencies
  describe.concurrent(`constraint operations (pg${pgVersion})`, () => {
    test("add primary key constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
        `,
        description: "add primary key constraint",
      });
    });

    test("add unique constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_email_key UNIQUE (email);
        `,
        description: "add unique constraint",
      });
    });

    test("add check constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            price numeric(10,2) NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.products ADD CONSTRAINT products_price_check CHECK (price > 0);
        `,
        description: "add check constraint",
      });
    });

    test("drop primary key constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            CONSTRAINT users_pkey PRIMARY KEY (id)
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users DROP CONSTRAINT users_pkey;
        `,
        description: "drop primary key constraint",
      });
    });

    test("add foreign key constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            CONSTRAINT users_pkey PRIMARY KEY (id)
          );
          CREATE TABLE test_schema.orders (
            id integer NOT NULL,
            user_id integer NOT NULL
          );
        `,
        testSql: `
          ALTER TABLE test_schema.orders ADD CONSTRAINT orders_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES test_schema.users (id) ON DELETE CASCADE;
        `,
        description: "add foreign key constraint",
      });
    });

    test("drop unique constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            CONSTRAINT users_email_key UNIQUE (email)
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users DROP CONSTRAINT users_email_key;
        `,
        description: "drop unique constraint",
      });
    });

    test("drop check constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.products (
            id integer NOT NULL,
            price numeric(10,2) NOT NULL,
            CONSTRAINT products_price_check CHECK (price > 0)
          );
        `,
        testSql: `
          ALTER TABLE test_schema.products DROP CONSTRAINT products_price_check;
        `,
        description: "drop check constraint",
      });
    });

    test("drop foreign key constraint", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            CONSTRAINT users_pkey PRIMARY KEY (id)
          );
          CREATE TABLE test_schema.orders (
            id integer NOT NULL,
            user_id integer NOT NULL,
            CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES test_schema.users (id)
          );
        `,
        testSql: `
          ALTER TABLE test_schema.orders DROP CONSTRAINT orders_user_id_fkey;
        `,
        description: "drop foreign key constraint",
      });
    });

    test("add multiple constraints to same table", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA test_schema;
          CREATE TABLE test_schema.users (
            id integer NOT NULL,
            email character varying(255) NOT NULL,
            age integer
          );
        `,
        testSql: `
          ALTER TABLE test_schema.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
          ALTER TABLE test_schema.users ADD CONSTRAINT users_email_key UNIQUE (email);
          ALTER TABLE test_schema.users ADD CONSTRAINT users_age_check CHECK (age >= 0);
        `,
        description: "add multiple constraints to same table",
      });
    });

    test("constraint with special characters in names", async ({ db }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
          CREATE SCHEMA "my-schema";
          CREATE TABLE "my-schema"."my-table" (
            id integer NOT NULL,
            "my-field" text
          );
        `,
        testSql: `
          ALTER TABLE "my-schema"."my-table" ADD CONSTRAINT "my-table_check$constraint"
            CHECK ("my-field" IS NOT NULL);
        `,
        description: "constraint with special characters in names",
      });
    });
  });
}
