/**
 * Integration tests for sensitive information handling in migration scripts.
 */

import dedent from "dedent";
import { describe } from "vitest";
import { POSTGRES_VERSIONS } from "../constants.ts";
import { getTest, getTestIsolated } from "../utils.ts";
import { roundtripFidelityTest } from "./roundtrip.ts";

for (const pgVersion of POSTGRES_VERSIONS) {
  const test = getTest(pgVersion);
  const testIsolated = getTestIsolated(pgVersion);

  describe.concurrent(`sensitive info handling (pg${pgVersion})`, () => {
    testIsolated(
      "role with LOGIN generates password warning",
      async ({ db }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `CREATE ROLE test_login_role WITH LOGIN;`,
          expectedSqlTerms: [
            dedent`
              -- WARNING: Role requires password to be set manually
              -- Run: ALTER ROLE test_login_role PASSWORD '<your-password-here>';
              CREATE ROLE test_login_role WITH LOGIN
            `,
          ],
        });
      },
    );

    test("subscription with password in conninfo is masked", async ({ db }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

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
          dedent`
          -- WARNING: Connection string contains sensitive password
          -- Replace __SENSITIVE_PASSWORD__ with actual password or run ALTER SUBSCRIPTION sub_sensitive CONNECTION after this script
          CREATE SUBSCRIPTION sub_sensitive CONNECTION 'dbname=${mainDbName} password=__SENSITIVE_PASSWORD__' PUBLICATION sub_sensitive_pub WITH (enabled = false, slot_name = NONE, create_slot = false, connect = false)`,
        ],
        postMigrationSql: `
          ALTER SUBSCRIPTION sub_sensitive CONNECTION 'dbname=${mainDbName} password=secret123';
        `,
      });
    });

    test("server with sensitive options are masked", async ({ db }) => {
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
          dedent`
            -- WARNING: Server contains sensitive options (password, user)
            -- Replace placeholders below or run ALTER SERVER test_sensitive_server2 after this script
            CREATE SERVER test_sensitive_server2 FOREIGN DATA WRAPPER test_sensitive_fdw OPTIONS (password '__SENSITIVE_PASSWORD__', user '__SENSITIVE_USER__', host 'localhost')
          `,
        ],
        postMigrationSql: `
          ALTER SERVER test_sensitive_server2 OPTIONS (SET password 'secret123', SET user 'testuser');
        `,
      });
    });

    test("user mapping with sensitive options are masked", async ({ db }) => {
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
          "CREATE SERVER test_um_server FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host 'localhost')",
          dedent`
            -- WARNING: User mapping contains sensitive options (user, password)
            -- Replace placeholders below or run ALTER USER MAPPING after this script
            CREATE USER MAPPING FOR postgres SERVER test_um_server OPTIONS (user '__SENSITIVE_USER__', password '__SENSITIVE_PASSWORD__')
          `,
        ],
        postMigrationSql: `
          ALTER USER MAPPING FOR postgres SERVER test_um_server OPTIONS (SET user 'testuser', SET password 'secret456');
        `,
      });
    });

    test("alter subscription connection with password is ignored (env-dependent)", async ({
      db,
    }) => {
      const [{ name: mainDbName }] =
        await db.main`select current_database() as name`;

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
        skipMigrationExecution: false,
      });
    });

    testIsolated(
      "role without LOGIN does not generate password warning",
      async ({ db }) => {
        await roundtripFidelityTest({
          mainSession: db.main,
          branchSession: db.branch,
          testSql: `CREATE ROLE test_no_login_role WITH NOLOGIN;`,
          expectedSqlTerms: ["CREATE ROLE test_no_login_role"],
        });
      },
    );
  });
}
