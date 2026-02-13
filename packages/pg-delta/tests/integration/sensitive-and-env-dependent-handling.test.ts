/**
 * Integration tests for sensitive information and environment-dependent value handling.
 *
 * This file covers two related concerns:
 * 1. Masking/Placeholders: Sensitive values are replaced with placeholders in CREATE statements
 * 2. Diff Filtering: Environment-dependent value changes are ignored during diff (SET actions filtered)
 */

import { describe, test } from "bun:test";
import { sql } from "@ts-safeql/sql-tag";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { withDb, withDbIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  describe(`sensitive and env-dependent handling (pg${pgVersion})`, () => {
    describe("masking and placeholders (CREATE operations)", () => {
      test(
        "role with LOGIN generates password warning",
        withDbIsolated(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            testSql: `CREATE ROLE test_login_role WITH LOGIN;`,
            expectedSqlTerms: ["CREATE ROLE test_login_role WITH LOGIN"],
          });
        }),
      );

      test(
        "role without LOGIN does not generate password warning",
        withDbIsolated(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            testSql: `CREATE ROLE test_no_login_role WITH NOLOGIN;`,
            expectedSqlTerms: ["CREATE ROLE test_no_login_role"],
          });
        }),
      );

      test(
        "subscription with password in conninfo is masked",
        withDb(pgVersion, async (db) => {
          const {
            rows: [{ name: mainDbName }],
          } = await db.main.query<{ name: string }>(
            sql`select current_database() as name`,
          );

          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `CREATE PUBLICATION sub_sensitive_pub FOR ALL TABLES;`,
            testSql: `
              CREATE SUBSCRIPTION sub_sensitive
                CONNECTION 'dbname=${mainDbName} password=secret123'
                PUBLICATION sub_sensitive_pub
                WITH (
                  connect = false,
                  create_slot = false,
                  enabled = false,
                  slot_name = NONE
                );
            `,
            expectedSqlTerms: [
              "CREATE SUBSCRIPTION sub_sensitive CONNECTION 'host=__CONN_HOST__ port=__CONN_PORT__ dbname=__CONN_DBNAME__ user=__CONN_USER__ password=__CONN_PASSWORD__' PUBLICATION sub_sensitive_pub WITH (enabled = false, slot_name = NONE, create_slot = false, connect = false)",
            ],
          });
        }),
      );

      test(
        "server with options are masked",
        withDb(pgVersion, async (db) => {
          // Note: postgres_fdw doesn't accept password/user in server options,
          // so we test with a custom FDW that accepts arbitrary options
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            testSql: `
              CREATE FOREIGN DATA WRAPPER test_sensitive_fdw;
              CREATE SERVER test_sensitive_server2
                FOREIGN DATA WRAPPER test_sensitive_fdw
                OPTIONS (password 'secret123', user 'testuser', host 'localhost');
            `,
            expectedSqlTerms: [
              "CREATE FOREIGN DATA WRAPPER test_sensitive_fdw NO HANDLER NO VALIDATOR",
              "CREATE SERVER test_sensitive_server2 FOREIGN DATA WRAPPER test_sensitive_fdw OPTIONS (password '__OPTION_PASSWORD__', user '__OPTION_USER__', host '__OPTION_HOST__')",
            ],
          });
        }),
      );

      test(
        "user mapping with options are masked",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
              CREATE EXTENSION IF NOT EXISTS postgres_fdw;
            `,
            testSql: `
              CREATE SERVER test_um_server
                FOREIGN DATA WRAPPER postgres_fdw
                OPTIONS (host 'localhost');
              CREATE USER MAPPING FOR CURRENT_USER
                SERVER test_um_server
                OPTIONS (user 'testuser', password 'secret456');
            `,
            expectedSqlTerms: [
              "CREATE SERVER test_um_server FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host '__OPTION_HOST__')",
              "CREATE USER MAPPING FOR postgres SERVER test_um_server OPTIONS (user '__OPTION_USER__', password '__OPTION_PASSWORD__')",
            ],
          });
        }),
      );
    });

    describe("diff filtering (ALTER operations)", () => {
      test(
        "alter role password does not generate ALTER statement",
        withDbIsolated(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
                CREATE ROLE test_password_role WITH LOGIN;
              `,
            testSql: `
                ALTER ROLE test_password_role PASSWORD 'newpassword123';
              `,
            // Password changes are environment-dependent and should be ignored during diff
            expectedSqlTerms: [],
          });
        }),
      );

      test(
        "alter subscription connection with password is ignored",
        withDb(pgVersion, async (db) => {
          const {
            rows: [{ name: mainDbName }],
          } = await db.main.query<{ name: string }>(
            sql`select current_database() as name`,
          );

          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
              CREATE PUBLICATION sub_alter_sensitive_pub FOR ALL TABLES;
              CREATE SUBSCRIPTION sub_alter_sensitive
                CONNECTION 'dbname=${mainDbName}'
                PUBLICATION sub_alter_sensitive_pub
                WITH (
                  connect = false,
                  create_slot = false,
                  enabled = false,
                  slot_name = NONE
                );
            `,
            testSql: `
              ALTER SUBSCRIPTION sub_alter_sensitive
                CONNECTION 'dbname=${mainDbName} password=newsecret';
            `,
            // Conninfo changes are environment-dependent and should be ignored during diff
            expectedSqlTerms: [],
          });
        }),
      );

      test(
        "subscription: changing conninfo does not generate ALTER",
        withDb(pgVersion, async (db) => {
          const {
            rows: [{ name: mainDbName }],
          } = await db.main.query<{ name: string }>(
            sql`select current_database() as name`,
          );

          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
              CREATE PUBLICATION sub_env_pub FOR ALL TABLES;
              CREATE SUBSCRIPTION sub_env
                CONNECTION 'dbname=${mainDbName} host=prod.example.com port=5432'
                PUBLICATION sub_env_pub
                WITH (
                  connect = false,
                  create_slot = false,
                  enabled = false,
                  slot_name = NONE
                );
            `,
            testSql: `
              ALTER SUBSCRIPTION sub_env
                CONNECTION 'dbname=${mainDbName} host=dev.example.com port=5433';
            `,
            // Conninfo changes are environment-dependent and should be ignored
            expectedSqlTerms: [],
          });
        }),
      );

      test(
        "subscription: changing non-conninfo properties still generates ALTER",
        withDb(pgVersion, async (db) => {
          const {
            rows: [{ name: mainDbName }],
          } = await db.main.query<{ name: string }>(
            sql`select current_database() as name`,
          );

          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
              CREATE PUBLICATION sub_env_pub FOR ALL TABLES;
              CREATE SUBSCRIPTION sub_env
                CONNECTION 'dbname=${mainDbName}'
                PUBLICATION sub_env_pub
                WITH (
                  connect = false,
                  create_slot = false,
                  enabled = false,
                  slot_name = NONE
                );
            `,
            testSql: `
              ALTER SUBSCRIPTION sub_env SET (binary = true);
            `,
            expectedSqlTerms: [
              "ALTER SUBSCRIPTION sub_env SET (binary = true)",
            ],
          });
        }),
      );

      test(
        "server: SET option changes do not generate ALTER",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
              CREATE FOREIGN DATA WRAPPER test_env_fdw;
              CREATE SERVER test_env_server
                FOREIGN DATA WRAPPER test_env_fdw
                OPTIONS (host 'prod.example.com', port '5432', dbname 'prod_db', fetch_size '100');
            `,
            testSql: `
              ALTER SERVER test_env_server OPTIONS (
                SET host 'dev.example.com',
                SET port '5433',
                SET dbname 'dev_db',
                SET fetch_size '200'
              );
            `,
            // SET actions are filtered out, so no ALTER should be generated
            expectedSqlTerms: [],
          });
        }),
      );

      test(
        "server: adding options generates ALTER (ADD not filtered)",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
              CREATE FOREIGN DATA WRAPPER test_env_fdw;
              CREATE SERVER test_env_server
                FOREIGN DATA WRAPPER test_env_fdw
                OPTIONS (fetch_size '100');
            `,
            testSql: `
              ALTER SERVER test_env_server OPTIONS (
                ADD host 'dev.example.com',
                ADD port '5433'
              );
            `,
            // ADD actions are not filtered, so ALTER should be generated
            expectedSqlTerms: [
              "ALTER SERVER test_env_server OPTIONS (ADD host '__OPTION_HOST__', ADD port '__OPTION_PORT__')",
            ],
          });
        }),
      );

      test(
        "user mapping: SET option changes do not generate ALTER",
        withDb(pgVersion, async (db) => {
          await roundtripFidelityTest({
            mainSession: db.main,
            branchSession: db.branch,
            initialSetup: `
              CREATE EXTENSION IF NOT EXISTS postgres_fdw;
              CREATE SERVER test_um_server
                FOREIGN DATA WRAPPER postgres_fdw
                OPTIONS (host 'localhost');
              CREATE USER MAPPING FOR CURRENT_USER
                SERVER test_um_server
                OPTIONS (user 'prod_user', password 'prod_pass');
            `,
            testSql: `
              ALTER USER MAPPING FOR CURRENT_USER
                SERVER test_um_server
                OPTIONS (
                  SET user 'dev_user',
                  SET password 'dev_pass'
                );
            `,
            // SET actions are filtered out, so no ALTER should be generated
            expectedSqlTerms: [],
          });
        }),
      );
    });
  });
}
