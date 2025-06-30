import { describe, expect } from "vitest";
import { POSTGRES_VERSIONS } from "../../../tests/migra/constants.ts";
import { getTest } from "../../../tests/migra/utils.ts";
import { inspectPrivileges } from "./privileges.ts";

describe.concurrent(
  "inspect privileges",
  () => {
    for (const postgresVersion of POSTGRES_VERSIONS) {
      describe(`postgres ${postgresVersion}`, () => {
        const test = getTest(postgresVersion);

        test(`should be able to inspect stable properties of privileges`, async ({
          db,
        }) => {
          // arrange
          const fixture = /* sql */ `
            create role custom_role login;
          `;
          await Promise.all([db.a.unsafe(fixture), db.b.unsafe(fixture)]);
          // act
          const resultA = await inspectPrivileges(db.a);
          const resultB = await inspectPrivileges(db.b);
          // assert
          expect(resultA).toEqual(
            new Map([
              [
                "custom_role",
                {
                  can_bypass_rls: false,
                  can_create_databases: false,
                  can_create_roles: false,
                  can_inherit: true,
                  can_login: true,
                  can_replicate: false,
                  config: null,
                  connection_limit: -1,
                  is_superuser: false,
                  role_name: "custom_role",
                },
              ],
              [
                "pg_checkpoint",
                {
                  can_bypass_rls: false,
                  can_create_databases: false,
                  can_create_roles: false,
                  can_inherit: true,
                  can_login: false,
                  can_replicate: false,
                  config: null,
                  connection_limit: -1,
                  is_superuser: false,
                  role_name: "pg_checkpoint",
                },
              ],
              [
                "pg_create_subscription",
                {
                  can_bypass_rls: false,
                  can_create_databases: false,
                  can_create_roles: false,
                  can_inherit: true,
                  can_login: false,
                  can_replicate: false,
                  config: null,
                  connection_limit: -1,
                  is_superuser: false,
                  role_name: "pg_create_subscription",
                },
              ],
              [
                "pg_database_owner",
                {
                  can_bypass_rls: false,
                  can_create_databases: false,
                  can_create_roles: false,
                  can_inherit: true,
                  can_login: false,
                  can_replicate: false,
                  config: null,
                  connection_limit: -1,
                  is_superuser: false,
                  role_name: "pg_database_owner",
                },
              ],
              [
                "pg_maintain",
                {
                  can_bypass_rls: false,
                  can_create_databases: false,
                  can_create_roles: false,
                  can_inherit: true,
                  can_login: false,
                  can_replicate: false,
                  config: null,
                  connection_limit: -1,
                  is_superuser: false,
                  role_name: "pg_maintain",
                },
              ],
              [
                "pg_read_all_data",
                {
                  can_bypass_rls: false,
                  can_create_databases: false,
                  can_create_roles: false,
                  can_inherit: true,
                  can_login: false,
                  can_replicate: false,
                  config: null,
                  connection_limit: -1,
                  is_superuser: false,
                  role_name: "pg_read_all_data",
                },
              ],
              [
                "pg_use_reserved_connections",
                {
                  can_bypass_rls: false,
                  can_create_databases: false,
                  can_create_roles: false,
                  can_inherit: true,
                  can_login: false,
                  can_replicate: false,
                  config: null,
                  connection_limit: -1,
                  is_superuser: false,
                  role_name: "pg_use_reserved_connections",
                },
              ],
              [
                "pg_write_all_data",
                {
                  can_bypass_rls: false,
                  can_create_databases: false,
                  can_create_roles: false,
                  can_inherit: true,
                  can_login: false,
                  can_replicate: false,
                  config: null,
                  connection_limit: -1,
                  is_superuser: false,
                  role_name: "pg_write_all_data",
                },
              ],
              [
                "test",
                {
                  can_bypass_rls: true,
                  can_create_databases: true,
                  can_create_roles: true,
                  can_inherit: true,
                  can_login: true,
                  can_replicate: true,
                  config: null,
                  connection_limit: -1,
                  is_superuser: true,
                  role_name: "test",
                },
              ],
            ]),
          );
          expect(resultB).toEqual(resultA);
        });
      });
    }
  },
  30_000,
);
