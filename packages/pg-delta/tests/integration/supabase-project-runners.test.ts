import { expect, test } from "bun:test";
import dbdev from "./fixtures/supabase-projects/dbdev/project.ts";
import {
  buildSupabaseSmokeReproCommand,
  formatSmokeResultsSummary,
  resolveSupabaseSmokeStepConfig,
  type SupabaseSmokeStepResult,
} from "./supabase-project-runners.ts";

test("repro command targets the pg-delta package test script", () => {
  const command = buildSupabaseSmokeReproCommand(dbdev, "progressive", 2);

  expect(command).toContain("bun run --filter '@supabase/pg-delta' test");
  expect(command).toContain("PGDELTA_SUPABASE_PROJECT=dbdev");
  expect(command).toContain("PGDELTA_SUPABASE_SMOKE_STEP_FROM=2");
  expect(command).toContain(
    "tests/integration/supabase-project-progressive.test.ts",
  );
});

test("step config rejects invalid or empty smoke ranges", () => {
  expect(() =>
    resolveSupabaseSmokeStepConfig(4, {
      stepFromEnv: "3",
      stepToEnv: "1",
      skipApplyEnv: undefined,
    }),
  ).toThrow(/No smoke steps selected/i);

  expect(() =>
    resolveSupabaseSmokeStepConfig(4, {
      stepFromEnv: "not-a-number",
      stepToEnv: "1",
      skipApplyEnv: undefined,
    }),
  ).toThrow(/Invalid smoke step/i);

  expect(() =>
    resolveSupabaseSmokeStepConfig(4, {
      stepFromEnv: "0.5",
      stepToEnv: "1",
      skipApplyEnv: undefined,
    }),
  ).toThrow(/Invalid smoke step/i);
});

test("formatSmokeResultsSummary lists totals, icon per step, and apply= first", () => {
  const results: SupabaseSmokeStepResult[] = [
    {
      step: 0,
      migrationApplied: "(empty)",
      planStatus: "success",
      changeCount: 1,
      statementCount: 1,
      applyStatus: "success",
    },
    {
      step: 1,
      migrationApplied: "20220117141359_app_schema.sql",
      planStatus: "no_changes",
      changeCount: 0,
      statementCount: 0,
      applyStatus: "skipped",
    },
    {
      step: 2,
      migrationApplied: "20220117141507_semver.sql",
      planStatus: "error",
      planError: "boom",
    },
  ];

  const text = formatSmokeResultsSummary(
    dbdev,
    "progressive",
    "supabase/postgres:15",
    results,
    [],
  );

  expect(text).toContain("Totals — passed:");
  expect(text).toContain("failed: 1");
  expect(text).toMatch(/verification skipped.*0/);
  expect(text).toMatch(/✅ \*\*apply=success\*\*/);
  expect(text).toMatch(/✅ \*\*apply=skipped\*\*/);
  expect(text).toMatch(/❌ \*\*apply=— \(not run, plan error\)\*\*/);
  expect(text).toContain("Full results (per step:");
});
