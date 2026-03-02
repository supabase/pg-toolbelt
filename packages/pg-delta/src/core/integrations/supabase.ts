/**
 * Supabase integration - filtering and serialization rules for Supabase databases.
 *
 * This integration:
 * - Filters out Supabase system schemas and roles
 * - Includes user schemas and extensions
 * - Skips authorization for schema creates owned by Supabase system roles
 */

import type { IntegrationDSL } from "./integration-dsl.ts";

// Supabase system schemas that should be excluded
const SUPABASE_SYSTEM_SCHEMAS = [
  "_analytics",
  "_realtime",
  "_supavisor",
  "auth",
  "cron",
  "extensions",
  "graphql",
  "graphql_public",
  "information_schema",
  "net",
  "pgbouncer",
  "pgmq",
  "pgmq_public",
  "pgsodium",
  "pgsodium_masks",
  "pgtle",
  "realtime",
  "storage",
  "supabase_functions",
  "supabase_migrations",
  "vault",
] as const;

// Supabase system roles that should be excluded
const SUPABASE_SYSTEM_ROLES = [
  "anon",
  "authenticated",
  "authenticator",
  "cli_login_postgres",
  "dashboard_user",
  "pgbouncer",
  "pgsodium_keyholder",
  "pgsodium_keyiduser",
  "pgsodium_keymaker",
  "pgtle_admin",
  "service_role",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_etl_admin",
  "supabase_functions_admin",
  "supabase_read_only_user",
  "supabase_realtime_admin",
  "supabase_replication_admin",
  "supabase_storage_admin",
  "supabase_superuser",
] as const;

/**
 * To generate the emptyCatalog snapshot, run catalog-export against a fresh
 * supabase/postgres container:
 *
 *   pgdelta catalog-export --target postgres://postgres:postgres@localhost:54322/postgres --output supabase-baseline.json
 *
 * Then import and assign the JSON content to the emptyCatalog field below.
 */
export const supabase: IntegrationDSL = {
  // emptyCatalog: undefined -- populate by running catalog-export on a clean Supabase container
  filter: {
    or: [
      {
        and: [
          {
            type: "schema",
            operation: "create",
            scope: "object",
          },
          {
            not: {
              schema: [...SUPABASE_SYSTEM_SCHEMAS],
            },
          },
        ],
      },
      {
        type: "extension",
        operation: "create",
        scope: "object",
      },
      {
        not: {
          or: [
            {
              schema: [...SUPABASE_SYSTEM_SCHEMAS],
            },
            {
              owner: [...SUPABASE_SYSTEM_ROLES],
            },
            {
              and: [
                {
                  type: "role",
                  scope: "membership",
                },
                {
                  member: [...SUPABASE_SYSTEM_ROLES],
                },
              ],
            },
          ],
        },
      },
    ],
  },
  serialize: [
    {
      when: {
        type: "schema",
        operation: "create",
        scope: "object",
        owner: [...SUPABASE_SYSTEM_ROLES],
      },
      options: {
        skipAuthorization: true,
      },
    },
  ],
};
