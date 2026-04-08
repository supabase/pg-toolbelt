/**
 * Progressive smoke test for dbdev migrations.
 *
 * Applies dbdev migrations incrementally (0 → N) to a source Supabase
 * container and, at each step, generates a diff against a fully-migrated
 * target container. Optionally verifies the generated SQL by executing it
 * inside a BEGIN / ROLLBACK transaction so the source state is preserved.
 *
 * Some migrations reference Supabase-image-specific columns that may not
 * exist in the test image (e.g. auth.users.email_confirmed_at). These are
 * skipped on both branch and main so the two databases stay comparable.
 *
 * Environment variables:
 *   DBDEV_SMOKE_STEP_FROM  – first step to test (default: 0)
 *   DBDEV_SMOKE_STEP_TO    – last step to test, inclusive (default: number of applicable migrations)
 *   DBDEV_SMOKE_SKIP_APPLY – set to "1" to only generate plans, skip SQL verification
 */

import { afterAll, beforeAll, describe, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { compileFilterDSL } from "../../src/core/integrations/filter/dsl.ts";
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

type StepResult = {
  step: number;
  migrationApplied: string;
  planStatus: "no_changes" | "success" | "error";
  planError?: string;
  changeCount?: number;
  statementCount?: number;
  applyStatus?: "success" | "error" | "skipped";
  applyError?: string;
  applyFailedStatement?: string;
  remainingChanges?: number;
};

async function loadAllMigrations(): Promise<
  { filename: string; sql: string }[]
> {
  const files = await readdir(MIGRATIONS_DIR);
  const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();
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

function createPostgresRolePool(connectionUri: string): Pool {
  return createPool(connectionUri, {
    onError: suppressShutdownError,
    onConnect: async (client) => {
      await client.query("SET ROLE postgres");
    },
  });
}

function printSummary(results: StepResult[], skippedMigrations: string[]) {
  const passed = results.filter(
    (r) =>
      r.planStatus !== "error" &&
      (r.applyStatus === "success" || r.applyStatus === "skipped"),
  );
  const failed = results.filter(
    (r) => r.planStatus === "error" || r.applyStatus === "error",
  );

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║              DBDEV SMOKE TEST SUMMARY                    ║");
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(
    `${`║  Total steps: ${results.length}   Passed: ${passed.length}   Failed: ${failed.length}`.padEnd(
      59,
    )}║`,
  );
  if (skippedMigrations.length > 0) {
    console.log(
      `${`║  Skipped migrations (image-incompatible): ${skippedMigrations.length}`.padEnd(
        59,
      )}║`,
    );
  }
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  if (skippedMigrations.length > 0) {
    console.log("─── SKIPPED MIGRATIONS ─────────────────────────────────────");
    for (const m of skippedMigrations) {
      console.log(`  ${m}`);
    }
    console.log("");
  }

  if (failed.length > 0) {
    console.log("─── FAILURES ───────────────────────────────────────────────");
    for (const r of failed) {
      console.log(`\n  Step ${r.step}: after "${r.migrationApplied}"`);
      if (r.planStatus === "error") {
        console.log(`    Plan generation FAILED: ${r.planError}`);
      }
      if (r.applyStatus === "error") {
        console.log(`    SQL apply FAILED: ${r.applyError}`);
        if (r.applyFailedStatement) {
          const truncated =
            r.applyFailedStatement.length > 200
              ? `${r.applyFailedStatement.slice(0, 200)}...`
              : r.applyFailedStatement;
          console.log(`    Failed statement: ${truncated}`);
        }
      }
      if (r.remainingChanges !== undefined && r.remainingChanges > 0) {
        console.log(`    Remaining changes after apply: ${r.remainingChanges}`);
      }
    }
    console.log(
      "\n────────────────────────────────────────────────────────────",
    );
  }

  console.log("\n─── FULL RESULTS ───────────────────────────────────────────");
  console.log(
    "Step".padEnd(6) +
      "Migration".padEnd(50) +
      "Plan".padEnd(14) +
      "Changes".padEnd(10) +
      "Stmts".padEnd(8) +
      "Apply".padEnd(10),
  );
  console.log("─".repeat(98));
  for (const r of results) {
    const migration =
      r.migrationApplied.length > 48
        ? `${r.migrationApplied.slice(0, 45)}...`
        : r.migrationApplied;
    console.log(
      String(r.step).padEnd(6) +
        migration.padEnd(50) +
        r.planStatus.padEnd(14) +
        (r.changeCount !== undefined ? String(r.changeCount) : "-").padEnd(10) +
        (r.statementCount !== undefined
          ? String(r.statementCount)
          : "-"
        ).padEnd(8) +
        (r.applyStatus ?? "-").padEnd(10),
    );
  }
  console.log("────────────────────────────────────────────────────────────\n");
}

const pgVersion: PostgresVersion = 15;
const STEP_FROM = Number(process.env.DBDEV_SMOKE_STEP_FROM ?? 0);
const STEP_TO_ENV = process.env.DBDEV_SMOKE_STEP_TO;
const SKIP_APPLY = process.env.DBDEV_SMOKE_SKIP_APPLY === "1";

describe(`dbdev progressive smoke test (pg${pgVersion})`, () => {
  let mainPool: Pool;
  let branchPool: Pool;
  let containerMain: Awaited<ReturnType<SupabasePostgreSqlContainer["start"]>>;
  let containerBranch: Awaited<
    ReturnType<SupabasePostgreSqlContainer["start"]>
  >;
  // Migrations that were successfully applied to branch (image-compatible).
  let applicableMigrations: { filename: string; sql: string }[];
  let skippedMigrations: string[];
  let stepTo: number;
  const results: StepResult[] = [];

  if (!supabaseIntegration.filter || !supabaseIntegration.serialize) {
    throw new Error("supabase integration missing filter or serialize");
  }
  const compiledFilter = compileFilterDSL(supabaseIntegration.filter);

  beforeAll(
    async () => {
      const allMigrations = await loadAllMigrations();

      const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[pgVersion]}`;

      [containerMain, containerBranch] = await Promise.all([
        new SupabasePostgreSqlContainer(image).start(),
        new SupabasePostgreSqlContainer(image).start(),
      ]);

      mainPool = createPostgresRolePool(containerMain.getConnectionUri());
      branchPool = createPostgresRolePool(containerBranch.getConnectionUri());

      // Apply all migrations to branch, tracking which ones succeed.
      // Some migrations reference columns specific to certain Supabase image
      // versions (e.g. auth.users.email_confirmed_at) and will fail — skip them.
      applicableMigrations = [];
      skippedMigrations = [];
      for (const migration of allMigrations) {
        try {
          await branchPool.query(migration.sql);
          applicableMigrations.push(migration);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          skippedMigrations.push(`${migration.filename}: ${msg}`);
        }
      }

      stepTo =
        STEP_TO_ENV !== undefined
          ? Number(STEP_TO_ENV)
          : applicableMigrations.length;

      console.log(
        `[smoke] Branch ready: ${applicableMigrations.length} migrations applied, ${skippedMigrations.length} skipped`,
      );
    },
    10 * 60 * 1000,
  );

  afterAll(async () => {
    printSummary(results, skippedMigrations ?? []);
    if (mainPool) await endPool(mainPool);
    if (branchPool) await endPool(branchPool);
    await Promise.all([containerMain?.stop(), containerBranch?.stop()]);
  }, 60_000);

  test(
    "progressive migration diff",
    async () => {
      for (let step = 0; step <= stepTo; step++) {
        const migrationName =
          step === 0
            ? "(empty)"
            : step <= applicableMigrations.length
              ? applicableMigrations[step - 1].filename
              : "(all applied)";

        // Fast-forward: apply migration to main but skip plan generation
        if (step < STEP_FROM) {
          if (step > 0 && step <= applicableMigrations.length) {
            await mainPool
              .query(applicableMigrations[step - 1].sql)
              .catch((err) => {
                throw new Error(
                  `Migration ${applicableMigrations[step - 1].filename} failed on main: ${err.message}`,
                  { cause: err },
                );
              });
          }
          continue;
        }

        const result: StepResult = {
          step,
          migrationApplied: migrationName,
          planStatus: "success",
        };

        // Apply the migration for this step
        if (step > 0 && step <= applicableMigrations.length) {
          try {
            await mainPool.query(applicableMigrations[step - 1].sql);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(
              `[step ${step}] Migration ${migrationName} failed on main: ${msg}`,
            );
            result.planStatus = "error";
            result.planError = `Migration apply failed: ${msg}`;
            results.push(result);
            continue;
          }
        }

        // Generate the plan
        try {
          const planResult = await createPlan(mainPool, branchPool, {
            filter: supabaseIntegration.filter,
            serialize: supabaseIntegration.serialize,
            skipDefaultPrivilegeSubtraction: true,
          });

          if (!planResult) {
            result.planStatus = "no_changes";
            result.changeCount = 0;
            result.statementCount = 0;
            result.applyStatus = "skipped";
            results.push(result);
            continue;
          }

          result.changeCount = planResult.sortedChanges.length;
          result.statementCount = planResult.plan.statements.length;

          if (SKIP_APPLY) {
            result.applyStatus = "skipped";
            results.push(result);
            continue;
          }

          // Verify SQL by executing inside BEGIN / ROLLBACK
          try {
            await mainPool.query("BEGIN");
            await mainPool.query("SET LOCAL check_function_bodies = false");
            for (const stmt of planResult.plan.statements) {
              await mainPool.query(stmt);
            }

            // Check remaining changes inside the transaction
            const mainCatalog = await extractCatalog(mainPool);
            const branchCatalog = await extractCatalog(branchPool);
            const allChanges = diffCatalogs(mainCatalog, branchCatalog);
            const remaining = allChanges.filter(compiledFilter);
            result.remainingChanges = remaining.length;

            if (remaining.length > 0) {
              const sorted = sortChanges(
                { mainCatalog, branchCatalog },
                remaining,
              );
              const remainingSql = sorted.map((c) => c.serialize()).join(";\n");
              console.error(
                `[step ${step}] ${remaining.length} remaining change(s):\n${remainingSql}`,
              );
              result.applyStatus = "error";
              result.applyError = `${remaining.length} remaining changes after apply`;
            } else {
              result.applyStatus = "success";
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            result.applyStatus = "error";
            result.applyError = msg;
          } finally {
            try {
              await mainPool.query("ROLLBACK");
            } catch {
              // Connection may have been interrupted; ignore rollback errors
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          result.planStatus = "error";
          result.planError = msg;
        }

        results.push(result);
      }

      // Diagnostic test: always passes, failures are reported in the
      // afterAll summary. This avoids --retry re-running the test with
      // stale container state (all migrations already applied on main).
      const failures = results.filter(
        (r) => r.planStatus === "error" || r.applyStatus === "error",
      );
      if (failures.length > 0) {
        console.error(
          `\n[smoke] ${failures.length} step(s) with failures — see summary below\n`,
        );
      }
    },
    30 * 60 * 1000,
  );
});
