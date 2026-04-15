import { expect, test } from "bun:test";
import dbdev from "./fixtures/supabase-projects/dbdev/project.ts";
import {
  buildSupabaseSmokeReproCommand,
  resolveSupabaseSmokeStepConfig,
} from "./supabase-project-runners.ts";

test("repro command targets the pg-delta package test script", () => {
  const command = buildSupabaseSmokeReproCommand(dbdev, "progressive", 2);

  expect(command).toContain("bun run --filter '@supabase/pg-delta' test");
  expect(command).toContain("PGDELTA_SUPABASE_PROJECT=dbdev");
  expect(command).toContain("PGDELTA_SUPABASE_SMOKE_STEP_FROM=2");
  expect(command).toContain("tests/integration/supabase-project-progressive.test.ts");
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
