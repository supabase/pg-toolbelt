/**
 * A NOT VALID table constraint must not get a trailing VALIDATE CONSTRAINT
 * step. AlterTableAddConstraint serializes pg_get_constraintdef as-is, and that
 * output already includes the NOT VALID suffix, so the ADD on its own matches
 * the target. A VALIDATE would mark it convalidated = true, the reverse of what
 * we want, and the plan would loop forever.
 *
 * These cases use the realtime.messages.messages_payload_exclusive constraint
 * from Supabase Realtime, whose baseline records
 * CHECK (payload IS NULL OR binary_payload IS NULL) NOT VALID.
 */

import { describe, expect, test } from "bun:test";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

const assertNoValidate = (sqlStatements: string[]) => {
  expect(sqlStatements.some((sql) => /VALIDATE CONSTRAINT/i.test(sql))).toBe(
    false,
  );
};

const assertValidateShortcut = (sqlStatements: string[]) => {
  const validateCount = sqlStatements.filter((sql) =>
    /VALIDATE CONSTRAINT/i.test(sql),
  ).length;
  expect(validateCount).toBe(1);

  expect(
    sqlStatements.some((sql) =>
      /DROP CONSTRAINT\s+messages_payload_exclusive/i.test(sql),
    ),
  ).toBe(false);
  expect(
    sqlStatements.some((sql) =>
      /ADD CONSTRAINT\s+messages_payload_exclusive/i.test(sql),
    ),
  ).toBe(false);
};

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`NOT VALID constraint convergence (pg${pgVersion})`, () => {
    test(
      "created NOT VALID check constraint converges without VALIDATE",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.messages (
              payload jsonb,
              binary_payload bytea
            );
          `,
          testSql: `
            ALTER TABLE test_schema.messages
              ADD CONSTRAINT messages_payload_exclusive
              CHECK (payload IS NULL OR binary_payload IS NULL) NOT VALID;
          `,
          assertSqlStatements: assertNoValidate,
        });
      }),
    );

    test(
      "validated -> NOT VALID drift converges without re-validating",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.messages (
              payload jsonb,
              binary_payload bytea
            );
            ALTER TABLE test_schema.messages
              ADD CONSTRAINT messages_payload_exclusive
              CHECK (payload IS NULL OR binary_payload IS NULL);
          `,
          testSql: `
            ALTER TABLE test_schema.messages
              DROP CONSTRAINT messages_payload_exclusive;
            ALTER TABLE test_schema.messages
              ADD CONSTRAINT messages_payload_exclusive
              CHECK (payload IS NULL OR binary_payload IS NULL) NOT VALID;
          `,
          assertSqlStatements: assertNoValidate,
        });
      }),
    );

    test(
      "NOT VALID -> validated drift converges via VALIDATE CONSTRAINT (no drop+add)",
      withDb(pgVersion, async (db) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          initialSetup: `
            CREATE SCHEMA test_schema;
            CREATE TABLE test_schema.messages (
              payload jsonb,
              binary_payload bytea
            );
            ALTER TABLE test_schema.messages
              ADD CONSTRAINT messages_payload_exclusive
              CHECK (payload IS NULL OR binary_payload IS NULL) NOT VALID;
          `,
          testSql: `
            ALTER TABLE test_schema.messages
              VALIDATE CONSTRAINT messages_payload_exclusive;
          `,
          assertSqlStatements: assertValidateShortcut,
        });
      }),
    );
  });
}
