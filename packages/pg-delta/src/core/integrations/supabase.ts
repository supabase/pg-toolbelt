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
  "etl",
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
  // TODO: emptyCatalog: undefined -- populate by running catalog-export on a clean Supabase container
  filter: {
    or: [
      // Include user schema CREATE operations (only schemas not in system list)
      {
        and: [
          {
            objectType: "schema",
            operation: "create",
            scope: "object",
          },
          {
            not: {
              // Schema objects have name, not schema — use schema/name
              "schema/name": [...SUPABASE_SYSTEM_SCHEMAS],
            },
          },
        ],
      },
      // Include extension CREATEs
      {
        objectType: "extension",
        operation: "create",
        scope: "object",
      },
      // Include extension DROPs used to disable some extensions (eg: pg-net)
      {
        objectType: "extension",
        operation: "drop",
        scope: "object",
      },
      // Include user-attached triggers on tables in Supabase-managed schemas.
      //
      // Triggers live in the schema of the table they fire on, so a user
      // trigger on `auth.users` reports `trigger/schema = auth` and is
      // otherwise indistinguishable from Supabase's own triggers via the
      // schema-level deny list. Triggers also have no real owner — pg-delta
      // surfaces the parent table's owner as `trigger/owner`, which for
      // `auth.users` and `storage.objects` is always a Supabase system role,
      // so the owner-level deny list catches them too.
      //
      // The trigger function, however, is genuinely user-owned: a customer
      // who wants to run code on an auth event creates a function in
      // `public` (or any non-managed schema) and points the trigger at it.
      // Supabase's own auth/storage triggers either come from extensions
      // (already filtered out at extract time via `pg_depend`) or call
      // functions inside the same managed schema, so `function_schema`
      // outside the managed list is a reliable user-defined marker.
      {
        and: [
          { objectType: "trigger" },
          { "trigger/schema": [...SUPABASE_SYSTEM_SCHEMAS] },
          {
            not: {
              "trigger/function_schema": [...SUPABASE_SYSTEM_SCHEMAS],
            },
          },
        ],
      },
      // Exclude system objects
      {
        not: {
          or: [
            // Objects in system schemas (*/schema matches table/schema, view/schema, etc.)
            {
              "*/schema": [...SUPABASE_SYSTEM_SCHEMAS],
            },
            // Schema objects whose own name is a system schema
            {
              "schema/name": [...SUPABASE_SYSTEM_SCHEMAS],
            },
            // Objects owned by system roles (*/owner matches table/owner, schema/owner, etc.)
            {
              "*/owner": [...SUPABASE_SYSTEM_ROLES],
            },
            // Role objects whose own name is a system role
            {
              "role/name": [...SUPABASE_SYSTEM_ROLES],
            },
            // Membership changes for system roles
            {
              and: [
                {
                  objectType: "role",
                  scope: "membership",
                },
                {
                  member: [...SUPABASE_SYSTEM_ROLES],
                },
              ],
            },
            // Platform-managed foreign data wrappers — Wasm-based FDWs
            // (e.g. `clerk`, `clerk_oauth`) whose handler/validator live in
            // the `extensions` schema. `CREATE FOREIGN DATA WRAPPER`
            // requires superuser, and Supabase Cloud provisions these via
            // `supabase_admin` at project creation; replaying the DDL
            // against a local image fails because the local environment
            // has no equivalent pre-step. We can't rely on the FDW owner
            // alone — after a dump/restore the owner is often rewritten
            // away from `supabase_admin` — so match on the function
            // reference instead.
            {
              and: [
                { objectType: "foreign_data_wrapper" },
                {
                  or: [
                    {
                      "foreign_data_wrapper/handler": {
                        op: "regex",
                        value: "^extensions\\.",
                      },
                    },
                    {
                      "foreign_data_wrapper/validator": {
                        op: "regex",
                        value: "^extensions\\.",
                      },
                    },
                  ],
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
        objectType: "schema",
        operation: "create",
        scope: "object",
        "schema/owner": [...SUPABASE_SYSTEM_ROLES],
      },
      options: {
        skipAuthorization: true,
      },
    },
    // Extensions whose install script creates its own target schema cannot
    // tolerate `CREATE EXTENSION … WITH SCHEMA <self>` against a fresh
    // database: Postgres resolves WITH SCHEMA before running the extension's
    // script, so the schema referenced by the clause does not exist yet.
    // These extensions also install into schemas listed in
    // SUPABASE_SYSTEM_SCHEMAS, so pg-delta filters their CREATE SCHEMA out
    // of the declarative plan — nothing else will pre-create the schema.
    // Emitting a bare `CREATE EXTENSION <name>` lets the extension's own
    // install script create the schema it expects.
    //
    // Note: other extensions install into SUPABASE_SYSTEM_SCHEMAS too
    // (`pg_graphql` → `graphql`, `supabase_vault` → `vault`,
    // `uuid-ossp`/`pgcrypto`/`pg_net`/`pg_stat_statements` → `extensions`),
    // but those schemas are created by the supabase/postgres image baseline
    // and survive `DROP EXTENSION … CASCADE`, so `CREATE EXTENSION … WITH
    // SCHEMA <schema>` finds the schema and succeeds. Only the three below
    // have self-created schemas that are absent from the baseline.
    {
      when: {
        objectType: "extension",
        operation: "create",
        scope: "object",
        "extension/schema": ["pgmq", "pgsodium", "pgtle"],
      },
      options: {
        skipSchema: true,
      },
    },
  ],
};
