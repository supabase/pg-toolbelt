/**
 * Integration test: dbdev declarative schema roundtrip with Supabase integration.
 *
 * Reproduces two bugs in the declarative export CLI command that cause a
 * roundtrip verification to fail on the real dbdev Supabase project:
 *
 * Bug 1 (Missing GRANT SELECT):
 *   The CLI connects as `postgres`, which is the same role that ran
 *   `ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT ON TABLES TO authenticated, anon`.
 *   When createPlan computes the default privilege state, it subtracts these
 *   defaults from the explicit GRANTs, so GRANT SELECT is never emitted. On
 *   re-apply, those GRANTs are missing because ALTER DEFAULT PRIVILEGES runs
 *   after CREATE TABLE (no explicit ordering in pg-topo).
 *
 * Bug 2 (Missing RLS policies with auth.uid()):
 *   The CLI pre-compiles the supabase filter DSL to a function before passing
 *   it to createPlan. When a function filter is used, cascading is enabled by
 *   default. The supabase filter excludes the `auth` schema, and the cascade
 *   logic removes all changes that depend on excluded auth objects via pg_depend.
 *   RLS policies with `auth.uid()` expressions have a pg_depend on auth.uid(),
 *   so they get cascade-excluded and never appear in the export.
 */

import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { applyDeclarativeSchema } from "../../src/core/declarative-apply/index.ts";
import { exportDeclarativeSchema } from "../../src/core/export/index.ts";
import { compileFilterDSL } from "../../src/core/integrations/filter/dsl.ts";
import { compileSerializeDSL } from "../../src/core/integrations/serialize/dsl.ts";
import { supabase as supabaseIntegration } from "../../src/core/integrations/supabase.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { createPool, endPool } from "../../src/core/postgres-config.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  type PostgresVersion,
} from "../constants.ts";
import { SupabasePostgreSqlContainer } from "../supabase-postgres.js";

const MIGRATIONS_DIR = path.join(
  import.meta.dir,
  "fixtures/dbdev-migrations/migrations",
);

/**
 * Load the core schema migrations that are sufficient to reproduce both bugs.
 *
 * We only apply the initial 20220117* migrations, which create all the
 * tables, types, functions, GRANTs, and RLS policies needed.  Later migrations
 * are data-only inserts that reference columns that changed across Supabase image
 * versions (e.g. storage.buckets.public, auth.users.email_confirmed_at) and are
 * not required to demonstrate the export bugs.
 */
async function loadMigrations(): Promise<{ filename: string; sql: string }[]> {
  const files = await readdir(MIGRATIONS_DIR);
  // Only the foundational 20220117 schema migrations -- sufficient to reproduce
  // both Bug 1 (GRANT SELECT subtraction) and Bug 2 (auth.uid() cascade).
  const sqlFiles = files
    .filter((f) => f.endsWith(".sql") && f.startsWith("20220117"))
    .sort();
  return Promise.all(
    sqlFiles.map(async (f) => ({
      filename: f,
      sql: await readFile(path.join(MIGRATIONS_DIR, f), "utf-8"),
    })),
  );
}

function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01" || err.code === "53100") return;
  console.error("Pool error:", err);
}

/**
 * Create a pool that connects as supabase_admin but immediately sets
 * the role to postgres on each connection. This makes currentUser = postgres
 * in catalog extractions, matching the real production scenario where the
 * CLI runs as the postgres superuser (reproduces Bug 1).
 */
function createPostgresRolePool(connectionUri: string): Pool {
  return createPool(connectionUri, {
    onError: suppressShutdownError,
    onConnect: async (client) => {
      await client.query("SET ROLE postgres");
    },
  });
}

// dbdev targets PG15 -- only run this test against that version.
const pgVersion: PostgresVersion = 15;

describe(`dbdev declarative roundtrip (pg${pgVersion})`, () => {
  test(
    "exported schema roundtrips to 0 remaining changes with supabase integration",
    async () => {
      const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[pgVersion]}`;

      // Start two fresh Supabase containers:
      //   containerMain  = clean baseline (no user migrations)
      //   containerBranch = desired state (all dbdev migrations applied)
      const [containerMain, containerBranch] = await Promise.all([
        new SupabasePostgreSqlContainer(image).start(),
        new SupabasePostgreSqlContainer(image).start(),
      ]);

      // Pools connect via supabase_admin but operate as postgres role so that:
      //  - Tables are owned by postgres (not a SUPABASE_SYSTEM_ROLE, so not filtered out)
      //  - ALTER DEFAULT PRIVILEGES is set for postgres
      //  - catalog.currentUser = postgres (triggering Bug 1 in the unfixed CLI path)
      const mainPool = createPostgresRolePool(containerMain.getConnectionUri());
      const branchPool = createPostgresRolePool(
        containerBranch.getConnectionUri(),
      );

      try {
        // Apply all dbdev migrations to branch in chronological (filename-sorted) order
        const migrations = await loadMigrations();
        for (const { filename, sql } of migrations) {
          await branchPool.query(sql).catch((err) => {
            throw new Error(`Migration ${filename} failed: ${err}`, {
              cause: err,
            });
          });
        }

        // ── Use the fixed CLI code path ─────────────────────────────────────
        //
        // Pass raw DSL (not compiled functions) to createPlan and enable
        // skipDefaultPrivilegeSubtraction. This matches the fixed
        // declarative-export.ts behavior:
        //   - Raw DSL → createPlan correctly disables cascading (Bug 2 fix)
        //   - skipDefaultPrivilegeSubtraction → all GRANTs emitted explicitly (Bug 1 fix)
        if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
          throw new Error("supabase integration missing filter or serialize");
        }
        const compiledFilter = compileFilterDSL(supabaseIntegration.filter);
        const compiledSerialize = compileSerializeDSL(
          supabaseIntegration.serialize,
        );

        const planResult = await createPlan(mainPool, branchPool, {
          filter: supabaseIntegration.filter,
          serialize: supabaseIntegration.serialize,
          skipDefaultPrivilegeSubtraction: true,
        });

        if (!planResult) {
          throw new Error(
            "createPlan returned null -- no changes detected between baseline and branch",
          );
        }

        const output = exportDeclarativeSchema(planResult, {
          integration: { serialize: compiledSerialize },
        });

        // Apply the exported declarative schema files to the clean main DB.
        // Disable final function body validation: functions reference auth.uid()
        // and other auth schema objects that exist in Supabase but aren't created
        // by the declarative export itself (they're system objects).
        const applyResult = await applyDeclarativeSchema({
          content: output.files.map((f) => ({ filePath: f.path, sql: f.sql })),
          pool: mainPool,
          disableCheckFunctionBodies: true,
          validateFunctionBodies: false,
        });

        if (applyResult.apply.status !== "success") {
          const stuckSql = applyResult.apply.stuckStatements
            ?.map((s) => `[${s.code}] ${s.message}\n  SQL: ${s.statement.sql}`)
            .join("\n");
          const errorSql = applyResult.apply.errors
            ?.map((s) => `[${s.code}] ${s.message}\n  SQL: ${s.statement.sql}`)
            .join("\n");
          throw new Error(
            `Declarative apply failed (${applyResult.apply.status}):\n${stuckSql ?? errorSql ?? "(no detail)"}`,
            { cause: applyResult },
          );
        }

        // Diff main (post-apply) vs branch -- the supabase filter should see 0 changes
        const mainCatalog = await extractCatalog(mainPool);
        const branchCatalog = await extractCatalog(branchPool);
        const allChanges = diffCatalogs(mainCatalog, branchCatalog);
        const remainingChanges = allChanges.filter(compiledFilter);

        if (remainingChanges.length > 0) {
          const sorted = sortChanges(
            { mainCatalog, branchCatalog },
            remainingChanges,
          );
          const remainingSql = sorted.map((c) => c.serialize()).join(";\n");
          console.error(
            `[dbdev-roundtrip] ${remainingChanges.length} remaining change(s) after roundtrip:\n${remainingSql}`,
          );
        }

        expect(remainingChanges).toHaveLength(0);
      } finally {
        await Promise.all([endPool(mainPool), endPool(branchPool)]);
        await Promise.all([containerMain.stop(), containerBranch.stop()]);
      }
    },
    5 * 60 * 1000, // 5 min -- two Supabase containers + 54 migrations
  );
});
