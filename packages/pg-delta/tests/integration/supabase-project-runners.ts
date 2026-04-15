import type { Pool } from "pg";
import { diffCatalogs } from "../../src/core/catalog.diff.ts";
import { extractCatalog } from "../../src/core/catalog.model.ts";
import { applyDeclarativeSchema } from "../../src/core/declarative-apply/index.ts";
import { exportDeclarativeSchema } from "../../src/core/export/index.ts";
import { compileFilterDSL } from "../../src/core/integrations/filter/dsl.ts";
import { compileSerializeDSL } from "../../src/core/integrations/serialize/dsl.ts";
import { createPlan } from "../../src/core/plan/create.ts";
import { createPool, endPool } from "../../src/core/postgres-config.ts";
import { sortChanges } from "../../src/core/sort/sort-changes.ts";
import { POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG } from "../constants.ts";
import { SupabasePostgreSqlContainer } from "../supabase-postgres.js";
import {
  loadSupabaseProjectMigrations,
  type SupabaseProjectFixture,
  type SupabaseProjectMigration,
} from "./supabase-project-fixture.ts";
import {
  writeSupabaseSmokeFailureArtifacts,
  type SupabaseSmokeScenarioName,
} from "./supabase-project-report.ts";

type ProjectPools = {
  mainPool: Pool;
  branchPool: Pool;
  image: string;
};

type AppliedMigrationResult = {
  appliedMigrations: SupabaseProjectMigration[];
  skippedMigrations: string[];
};

type SmokeStepResult = {
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
  planSql?: string;
  remainingSql?: string;
  sourceCatalog?: unknown;
  targetCatalog?: unknown;
};

function suppressShutdownError(err: Error & { code?: string }) {
  if (err.code === "57P01" || err.code === "53100") return;
  console.error("Pool error:", err);
}

function createProjectPool(
  fixture: SupabaseProjectFixture,
  connectionUri: string,
): Pool {
  return createPool(connectionUri, {
    onError: suppressShutdownError,
    onConnect: async (client) => {
      if (fixture.setRole) {
        await client.query(`SET ROLE ${fixture.setRole}`);
      }
    },
  });
}

async function withSupabaseProjectPools<T>(
  fixture: SupabaseProjectFixture,
  fn: (pools: ProjectPools) => Promise<T>,
): Promise<T> {
  const image = `supabase/postgres:${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[fixture.supabasePostgresVersion]}`;
  const [containerMain, containerBranch] = await Promise.all([
    new SupabasePostgreSqlContainer(image).start(),
    new SupabasePostgreSqlContainer(image).start(),
  ]);
  const mainPool = createProjectPool(fixture, containerMain.getConnectionUri());
  const branchPool = createProjectPool(
    fixture,
    containerBranch.getConnectionUri(),
  );

  try {
    return await fn({ mainPool, branchPool, image });
  } finally {
    await Promise.all([endPool(mainPool), endPool(branchPool)]);
    await Promise.all([containerMain.stop(), containerBranch.stop()]);
  }
}

async function applyProjectMigrations(
  pool: Pool,
  migrations: SupabaseProjectMigration[],
  onApplyError: "fail" | "skip" = "fail",
): Promise<AppliedMigrationResult> {
  const appliedMigrations: SupabaseProjectMigration[] = [];
  const skippedMigrations: string[] = [];

  for (const migration of migrations) {
    try {
      await pool.query(migration.sql);
      appliedMigrations.push(migration);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (onApplyError === "skip") {
        skippedMigrations.push(`${migration.filename}: ${message}`);
        continue;
      }

      throw new Error(`Migration ${migration.filename} failed: ${message}`, {
        cause: err,
      });
    }
  }

  return { appliedMigrations, skippedMigrations };
}

function formatRemainingChanges(
  mainCatalog: Awaited<ReturnType<typeof extractCatalog>>,
  branchCatalog: Awaited<ReturnType<typeof extractCatalog>>,
  remainingChanges: ReturnType<typeof diffCatalogs>,
) {
  const sorted = sortChanges({ mainCatalog, branchCatalog }, remainingChanges);
  const remainingSql = sorted.map((change) => change.serialize()).join(";\n");
  return {
    remainingSql,
    remainingSummary: sorted.map((change) => ({
      change: change.constructor.name,
      op: change.operation,
      objectType: change.objectType,
      scope: change.scope || "object",
      creates: change.creates,
      drops: change.drops,
      requires: change.requires,
    })),
  };
}

function formatDeclarativeApplyFailure(
  applyResult: Awaited<ReturnType<typeof applyDeclarativeSchema>>,
): string {
  const stuckSql = applyResult.apply.stuckStatements
    ?.map((statement) => `[${statement.code}] ${statement.message}\n  SQL: ${statement.statement.sql}`)
    .join("\n");
  const errorSql = applyResult.apply.errors
    ?.map((statement) => `[${statement.code}] ${statement.message}\n  SQL: ${statement.statement.sql}`)
    .join("\n");
  const validationSql = applyResult.apply.validationErrors
    ?.map((statement) => `[${statement.code}] ${statement.message}\n  SQL: ${statement.statement.sql}`)
    .join("\n");

  return stuckSql ?? errorSql ?? validationSql ?? "(no detail)";
}

export function resolveSupabaseSmokeStepConfig(
  totalSteps: number,
  env: {
    stepFromEnv?: string;
    stepToEnv?: string;
    skipApplyEnv?: string;
  } = {},
) {
  const stepFromRaw = env.stepFromEnv ?? process.env.PGDELTA_SUPABASE_SMOKE_STEP_FROM;
  const stepToRaw = env.stepToEnv ?? process.env.PGDELTA_SUPABASE_SMOKE_STEP_TO;
  const skipApplyRaw =
    env.skipApplyEnv ?? process.env.PGDELTA_SUPABASE_SMOKE_SKIP_APPLY;
  const stepFrom = stepFromRaw !== undefined ? Number(stepFromRaw) : 0;
  const stepTo = stepToRaw !== undefined ? Number(stepToRaw) : totalSteps;

  if (Number.isNaN(stepFrom) || Number.isNaN(stepTo)) {
    throw new Error(
      `Invalid smoke step range: from=${stepFromRaw ?? "0"} to=${stepToRaw ?? String(totalSteps)}`,
    );
  }

  if (!Number.isInteger(stepFrom) || !Number.isInteger(stepTo)) {
    throw new Error(
      `Invalid smoke step range: from=${stepFromRaw ?? "0"} to=${stepToRaw ?? String(totalSteps)}`,
    );
  }

  if (stepFrom < 0 || stepTo < 0) {
    throw new Error(`Invalid smoke step range: from=${stepFrom} to=${stepTo}`);
  }

  const boundedStepTo = Math.min(Math.max(stepTo, 0), totalSteps);

  if (stepFrom > boundedStepTo || stepFrom > totalSteps) {
    throw new Error(
      `No smoke steps selected: from=${stepFrom} to=${boundedStepTo} total=${totalSteps}`,
    );
  }

  return {
    stepFrom,
    stepTo: boundedStepTo,
    skipApply: skipApplyRaw === "1",
  };
}

function formatSmokeResultsSummary(
  fixture: SupabaseProjectFixture,
  scenarioName: "progressive" | "adjacent",
  image: string,
  results: SmokeStepResult[],
  skippedMigrations: string[],
): string {
  const failures = results.filter(
    (result) =>
      result.planStatus === "error" || result.applyStatus === "error",
  );

  const lines = [
    `${fixture.id} ${scenarioName} smoke failed on ${failures.length} step(s)`,
    `Image: ${image}`,
  ];

  if (skippedMigrations.length > 0) {
    lines.push(`Skipped migrations:\n${skippedMigrations.join("\n")}`);
  }

  for (const failure of failures) {
    lines.push(
      [
        `Step ${failure.step}: after "${failure.migrationApplied}"`,
        failure.planStatus === "error"
          ? `Plan generation failed: ${failure.planError}`
          : "",
        failure.applyStatus === "error"
          ? `Apply verification failed: ${failure.applyError}`
          : "",
        failure.applyFailedStatement
          ? `Failed statement:\n${failure.applyFailedStatement}`
          : "",
        failure.remainingChanges !== undefined
          ? `Remaining changes: ${failure.remainingChanges}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  lines.push(
    [
      "Full results:",
      ...results.map((result) =>
        [
          `- step=${result.step}`,
          `migration=${result.migrationApplied}`,
          `plan=${result.planStatus}`,
          `changes=${result.changeCount ?? "-"}`,
          `statements=${result.statementCount ?? "-"}`,
          `apply=${result.applyStatus ?? "-"}`,
        ].join(" "),
      ),
    ].join("\n"),
  );

  return lines.join("\n\n");
}

function getScenarioTestPath(scenarioName: SupabaseSmokeScenarioName): string {
  switch (scenarioName) {
    case "declarative":
      return "tests/integration/supabase-project-declarative.test.ts";
    case "progressive":
      return "tests/integration/supabase-project-progressive.test.ts";
    case "adjacent":
      return "tests/integration/supabase-project-adjacent.test.ts";
  }
}

export function buildSupabaseSmokeReproCommand(
  fixture: SupabaseProjectFixture,
  scenarioName: SupabaseSmokeScenarioName,
  step?: number,
): string {
  const parts = [
    `PGDELTA_TEST_POSTGRES_VERSIONS=${fixture.supabasePostgresVersion}`,
    `PGDELTA_SUPABASE_PROJECT=${fixture.id}`,
  ];

  if (step !== undefined && scenarioName !== "declarative") {
    parts.push(`PGDELTA_SUPABASE_SMOKE_STEP_FROM=${step}`);
    parts.push(`PGDELTA_SUPABASE_SMOKE_STEP_TO=${step}`);
  }

  parts.push("bun run --filter '@supabase/pg-delta' test");
  parts.push(getScenarioTestPath(scenarioName));
  return parts.join(" ");
}

async function writeScenarioFailureArtifacts(input: {
  fixture: SupabaseProjectFixture;
  scenarioName: SupabaseSmokeScenarioName;
  image: string;
  errorMessage: string;
  step?: number;
  migrationName?: string;
  skippedMigrations?: string[];
  planSql?: string;
  remainingSql?: string;
  sourceCatalog?: unknown;
  targetCatalog?: unknown;
}) {
  return writeSupabaseSmokeFailureArtifacts({
    fixtureId: input.fixture.id,
    fixtureDisplayName: input.fixture.displayName,
    scenarioName: input.scenarioName,
    image: input.image,
    step: input.step,
    migrationName: input.migrationName,
    errorMessage: input.errorMessage,
    skippedMigrations: input.skippedMigrations,
    reproCommand: buildSupabaseSmokeReproCommand(
      input.fixture,
      input.scenarioName,
      input.step,
    ),
    planSql: input.planSql,
    remainingSql: input.remainingSql,
    sourceCatalog: input.sourceCatalog,
    targetCatalog: input.targetCatalog,
    candidateRegressionNote: input.fixture.candidateRegressionNote,
  });
}

export async function runSupabaseProjectDeclarativeRoundtrip(
  fixture: SupabaseProjectFixture,
): Promise<void> {
  const scenario = fixture.scenarios.declarative;
  const migrations = await loadSupabaseProjectMigrations(fixture, "declarative");

  await withSupabaseProjectPools(fixture, async ({ mainPool, branchPool, image }) => {
    let skippedMigrations: string[] = [];
    let planSql: string | undefined;
    let remainingSql: string | undefined;
    let sourceCatalog: unknown;
    let targetCatalog: unknown;

    try {
      const applied = await applyProjectMigrations(
        branchPool,
        migrations,
        scenario.onApplyError ?? "fail",
      );
      skippedMigrations = applied.skippedMigrations;

      if (applied.appliedMigrations.length === 0) {
        throw new Error(
          `No migrations were applied for ${fixture.id} declarative scenario`,
        );
      }

      const compiledFilter = fixture.integration.filter
        ? compileFilterDSL(fixture.integration.filter)
        : undefined;
      const compiledSerialize = fixture.integration.serialize
        ? compileSerializeDSL(fixture.integration.serialize)
        : undefined;

      const planResult = await createPlan(mainPool, branchPool, {
        filter: fixture.integration.filter,
        serialize: fixture.integration.serialize,
        skipDefaultPrivilegeSubtraction:
          fixture.skipDefaultPrivilegeSubtraction ?? false,
      });

      if (!planResult) {
        throw new Error(
          `createPlan returned null for ${fixture.id} declarative scenario using ${image}`,
        );
      }

      const output = exportDeclarativeSchema(planResult, {
        integration: compiledSerialize
          ? { serialize: compiledSerialize }
          : undefined,
      });
      planSql = output.files
        .map((file) => `-- ${file.path}\n${file.sql}`)
        .join("\n\n");

      const applyResult = await applyDeclarativeSchema({
        content: output.files.map((file) => ({ filePath: file.path, sql: file.sql })),
        pool: mainPool,
        disableCheckFunctionBodies: true,
        validateFunctionBodies: fixture.validateFunctionBodies ?? false,
      });

      if (applyResult.apply.status !== "success") {
        throw new Error(
          [
            `Declarative apply failed for ${fixture.id} (${applyResult.apply.status})`,
            skippedMigrations.length > 0
              ? `Skipped migrations:\n${skippedMigrations.join("\n")}`
              : "",
            formatDeclarativeApplyFailure(applyResult),
          ]
            .filter(Boolean)
            .join("\n\n"),
          { cause: applyResult },
        );
      }

      const mainCatalog = await extractCatalog(mainPool);
      const branchCatalog = await extractCatalog(branchPool);
      sourceCatalog = mainCatalog;
      targetCatalog = branchCatalog;
      const allChanges = diffCatalogs(mainCatalog, branchCatalog);
      const remainingChanges = compiledFilter
        ? allChanges.filter(compiledFilter)
        : allChanges;

      if (remainingChanges.length > 0) {
        const formatted = formatRemainingChanges(
          mainCatalog,
          branchCatalog,
          remainingChanges,
        );
        remainingSql = formatted.remainingSql;

        throw new Error(
          [
            `Declarative roundtrip left ${remainingChanges.length} change(s) for ${fixture.id}`,
            `Image: ${image}`,
            skippedMigrations.length > 0
              ? `Skipped migrations:\n${skippedMigrations.join("\n")}`
              : "",
            `Remaining summary: ${JSON.stringify(formatted.remainingSummary, null, 2)}`,
            `Remaining SQL:\n${formatted.remainingSql || "(no SQL generated)"}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const artifacts = await writeScenarioFailureArtifacts({
        fixture,
        scenarioName: "declarative",
        image,
        errorMessage: message,
        skippedMigrations,
        planSql,
        remainingSql,
        sourceCatalog,
        targetCatalog,
      });

      throw new Error(`${message}\n\nFailure artifacts: ${artifacts.reportPath}`, {
        cause: err,
      });
    }
  });
}

export async function runSupabaseProjectProgressiveSmoke(
  fixture: SupabaseProjectFixture,
): Promise<void> {
  const scenario = fixture.scenarios.progressive;
  const migrations = await loadSupabaseProjectMigrations(fixture, "progressive");

  await withSupabaseProjectPools(fixture, async ({ mainPool, branchPool, image }) => {
    const { appliedMigrations, skippedMigrations } = await applyProjectMigrations(
      branchPool,
      migrations,
      scenario.onApplyError ?? "fail",
    );
    const { stepFrom, stepTo, skipApply } = resolveSupabaseSmokeStepConfig(
      appliedMigrations.length,
    );
    const compiledFilter = fixture.integration.filter
      ? compileFilterDSL(fixture.integration.filter)
      : undefined;
    const results: SmokeStepResult[] = [];

    for (let step = 0; step <= stepTo; step += 1) {
      const migrationName =
        step === 0 ? "(empty)" : appliedMigrations[step - 1].filename;

      if (step < stepFrom) {
        if (step > 0) {
          await mainPool.query(appliedMigrations[step - 1].sql);
        }
        continue;
      }

      const result: SmokeStepResult = {
        step,
        migrationApplied: migrationName,
        planStatus: "success",
      };

      if (step > 0) {
        try {
          await mainPool.query(appliedMigrations[step - 1].sql);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result.planStatus = "error";
          result.planError = `Migration apply failed on main: ${message}`;
          results.push(result);
          continue;
        }
      }

      try {
        const planResult = await createPlan(mainPool, branchPool, {
          filter: fixture.integration.filter,
          serialize: fixture.integration.serialize,
          skipDefaultPrivilegeSubtraction:
            fixture.skipDefaultPrivilegeSubtraction ?? false,
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
        result.planSql = planResult.plan.statements.join(";\n\n");

        if (skipApply) {
          result.applyStatus = "skipped";
          results.push(result);
          continue;
        }

        let failedStatement: string | undefined;

        try {
          await mainPool.query("BEGIN");
          await mainPool.query("SET LOCAL check_function_bodies = false");

          for (const statement of planResult.plan.statements) {
            failedStatement = statement;
            await mainPool.query(statement);
          }

          const mainCatalog = await extractCatalog(mainPool);
          const branchCatalog = await extractCatalog(branchPool);
          result.sourceCatalog = mainCatalog;
          result.targetCatalog = branchCatalog;
          const allChanges = diffCatalogs(mainCatalog, branchCatalog);
          const remainingChanges = compiledFilter
            ? allChanges.filter(compiledFilter)
            : allChanges;

          result.remainingChanges = remainingChanges.length;
          result.applyStatus =
            remainingChanges.length === 0 ? "success" : "error";

          if (remainingChanges.length > 0) {
            const { remainingSql } = formatRemainingChanges(
              mainCatalog,
              branchCatalog,
              remainingChanges,
            );
            result.remainingSql = remainingSql;
            result.applyError = remainingSql || "Remaining changes after apply";
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          result.applyStatus = "error";
          result.applyError = message;
          result.applyFailedStatement = failedStatement;
        } finally {
          try {
            await mainPool.query("ROLLBACK");
          } catch {
            // Connection may have been interrupted; ignore rollback errors.
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        result.planStatus = "error";
        result.planError = message;
      }

      results.push(result);
    }

    const failures = results.filter(
      (result) =>
        result.planStatus === "error" || result.applyStatus === "error",
    );
    if (failures.length > 0) {
      const summary = formatSmokeResultsSummary(
        fixture,
        "progressive",
        image,
        results,
        skippedMigrations,
      );
      const firstFailure = failures[0];
      const artifacts = await writeScenarioFailureArtifacts({
        fixture,
        scenarioName: "progressive",
        image,
        errorMessage: summary,
        step: firstFailure.step,
        migrationName: firstFailure.migrationApplied,
        skippedMigrations,
        planSql: firstFailure.planSql,
        remainingSql: firstFailure.remainingSql,
        sourceCatalog: firstFailure.sourceCatalog,
        targetCatalog: firstFailure.targetCatalog,
      });
      throw new Error(
        `${summary}\n\nFailure artifacts: ${artifacts.reportPath}`,
      );
    }
  });
}

export async function runSupabaseProjectAdjacentSmoke(
  fixture: SupabaseProjectFixture,
): Promise<void> {
  const scenario = fixture.scenarios.adjacent;
  const migrations = await loadSupabaseProjectMigrations(fixture, "adjacent");
  const applicable = await withSupabaseProjectPools(
    fixture,
    async ({ branchPool }) =>
      applyProjectMigrations(branchPool, migrations, scenario.onApplyError ?? "fail"),
  );

  if (applicable.appliedMigrations.length === 0) {
    throw new Error(`No migrations were applied for ${fixture.id} adjacent scenario`);
  }

  await withSupabaseProjectPools(fixture, async ({ mainPool, branchPool, image }) => {
    const maxStep = Math.max(applicable.appliedMigrations.length - 1, 0);
    const { stepFrom, stepTo, skipApply } = resolveSupabaseSmokeStepConfig(
      maxStep,
    );
    const compiledFilter = fixture.integration.filter
      ? compileFilterDSL(fixture.integration.filter)
      : undefined;
    const results: SmokeStepResult[] = [];

    for (
      let step = 0;
      step < applicable.appliedMigrations.length && step <= stepTo;
      step += 1
    ) {
      const migration = applicable.appliedMigrations[step];

      await branchPool.query(migration.sql).catch((err) => {
        throw new Error(
          `Migration ${migration.filename} failed on branch during adjacent smoke: ${err.message}`,
          { cause: err },
        );
      });

      if (step < stepFrom) {
        await mainPool.query(migration.sql);
        continue;
      }

      const result: SmokeStepResult = {
        step,
        migrationApplied: migration.filename,
        planStatus: "success",
      };

      try {
        const planResult = await createPlan(mainPool, branchPool, {
          filter: fixture.integration.filter,
          serialize: fixture.integration.serialize,
          skipDefaultPrivilegeSubtraction:
            fixture.skipDefaultPrivilegeSubtraction ?? false,
        });

        if (!planResult) {
          result.planStatus = "no_changes";
          result.changeCount = 0;
          result.statementCount = 0;
          result.applyStatus = "skipped";
        } else {
          result.changeCount = planResult.sortedChanges.length;
          result.statementCount = planResult.plan.statements.length;
          result.planSql = planResult.plan.statements.join(";\n\n");

          if (skipApply) {
            result.applyStatus = "skipped";
          } else {
            let failedStatement: string | undefined;

            try {
              await mainPool.query("BEGIN");
              await mainPool.query("SET LOCAL check_function_bodies = false");

              for (const statement of planResult.plan.statements) {
                failedStatement = statement;
                await mainPool.query(statement);
              }

              const mainCatalog = await extractCatalog(mainPool);
              const branchCatalog = await extractCatalog(branchPool);
              result.sourceCatalog = mainCatalog;
              result.targetCatalog = branchCatalog;
              const allChanges = diffCatalogs(mainCatalog, branchCatalog);
              const remainingChanges = compiledFilter
                ? allChanges.filter(compiledFilter)
                : allChanges;

              result.remainingChanges = remainingChanges.length;
              result.applyStatus =
                remainingChanges.length === 0 ? "success" : "error";

              if (remainingChanges.length > 0) {
                const { remainingSql } = formatRemainingChanges(
                  mainCatalog,
                  branchCatalog,
                  remainingChanges,
                );
                result.remainingSql = remainingSql;
                result.applyError =
                  remainingSql || "Remaining changes after adjacent apply";
              }
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              result.applyStatus = "error";
              result.applyError = message;
              result.applyFailedStatement = failedStatement;
            } finally {
              try {
                await mainPool.query("ROLLBACK");
              } catch {
                // Connection may have been interrupted; ignore rollback errors.
              }
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        result.planStatus = "error";
        result.planError = message;
      }

      results.push(result);

      await mainPool.query(migration.sql).catch((err) => {
        throw new Error(
          `Migration ${migration.filename} failed while advancing main during adjacent smoke: ${err.message}`,
          { cause: err },
        );
      });
    }

    const failures = results.filter(
      (result) =>
        result.planStatus === "error" || result.applyStatus === "error",
    );
    if (failures.length > 0) {
      const summary = formatSmokeResultsSummary(
        fixture,
        "adjacent",
        image,
        results,
        applicable.skippedMigrations,
      );
      const firstFailure = failures[0];
      const artifacts = await writeScenarioFailureArtifacts({
        fixture,
        scenarioName: "adjacent",
        image,
        errorMessage: summary,
        step: firstFailure.step,
        migrationName: firstFailure.migrationApplied,
        skippedMigrations: applicable.skippedMigrations,
        planSql: firstFailure.planSql,
        remainingSql: firstFailure.remainingSql,
        sourceCatalog: firstFailure.sourceCatalog,
        targetCatalog: firstFailure.targetCatalog,
      });
      throw new Error(
        `${summary}\n\nFailure artifacts: ${artifacts.reportPath}`,
      );
    }
  });
}
