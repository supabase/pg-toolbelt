/**
 * Integration tests for environment-dependent value handling in diff.
 * Verifies that env-specific values (host, port, credentials) are ignored
 * during diff comparison to avoid spurious ALTER statements.
 */

import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTestIsolated(pgVersion);

  describe.concurrent(`env-dependent handling (pg${pgVersion})`, () => {
    test("server: changing env-dependent options does not generate ALTER", async ({
      db,
    }) => {
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
        expectedSqlTerms: [
          "ALTER SERVER test_env_server OPTIONS (SET fetch_size '200')",
        ],
        skipMigrationExecution: false,
      });
    });

    test("server: changing only env-dependent options generates no ALTER", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
            CREATE FOREIGN DATA WRAPPER test_env_fdw;
            CREATE SERVER test_env_server
              FOREIGN DATA WRAPPER test_env_fdw
              OPTIONS (host 'prod.example.com', port '5432');
          `,
        testSql: `
            ALTER SERVER test_env_server OPTIONS (
              SET host 'dev.example.com',
              SET port '5433'
            );
          `,
        // Should generate no ALTER statement at all
        expectedSqlTerms: [],
        skipMigrationExecution: false,
      });
    });

    test("server: adding env-dependent option does not generate ALTER", async ({
      db,
    }) => {
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
        // Should generate no ALTER statement
        expectedSqlTerms: [],
        skipMigrationExecution: false,
      });
    });

    test("user mapping: changing credentials does not generate ALTER", async ({
      db,
    }) => {
      // Note: postgres_fdw user mappings only support 'user' and 'password' options,
      // both of which are env-dependent. So changing them should not generate ALTER.
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
        // Should generate no ALTER statement since both options are env-dependent
        expectedSqlTerms: [],
        skipMigrationExecution: false,
      });
    });

    test("user mapping: changing only credentials generates no ALTER", async ({
      db,
    }) => {
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
        // Should generate no ALTER statement
        expectedSqlTerms: [],
        skipMigrationExecution: false,
      });
    });

    test("subscription: changing conninfo does not generate ALTER", async ({
      db,
    }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

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
        // Should generate no ALTER statement for conninfo change
        expectedSqlTerms: [],
        skipMigrationExecution: false,
      });
    });

    test("subscription: changing non-conninfo properties still generates ALTER", async ({
      db,
    }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

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
        expectedSqlTerms: ["ALTER SUBSCRIPTION sub_env SET (binary = true)"],
        skipMigrationExecution: false,
      });
    });

    test("server: non-env option changes still generate ALTER", async ({
      db,
    }) => {
      await roundtripFidelityTest({
        mainSession: db.main,
        branchSession: db.branch,
        initialSetup: `
            CREATE FOREIGN DATA WRAPPER test_env_fdw;
            CREATE SERVER test_env_server
              FOREIGN DATA WRAPPER test_env_fdw
              OPTIONS (fetch_size '100', use_remote_estimate 'false');
          `,
        testSql: `
            ALTER SERVER test_env_server OPTIONS (
              SET fetch_size '200',
              SET use_remote_estimate 'true'
            );
          `,
        expectedSqlTerms: [
          "ALTER SERVER test_env_server OPTIONS (SET fetch_size '200', SET use_remote_estimate 'true')",
        ],
        skipMigrationExecution: false,
      });
    });
  });
}
