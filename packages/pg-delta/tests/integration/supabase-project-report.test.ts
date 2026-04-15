import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeSupabaseSmokeFailureArtifacts } from "./supabase-project-report.ts";

test("writes markdown and companion artifacts for smoke failures", async () => {
  const tempDir = await mkdtemp(
    path.join(os.tmpdir(), "pg-delta-supabase-smoke-"),
  );
  const result = await writeSupabaseSmokeFailureArtifacts({
    baseDir: tempDir,
    fixtureId: "dbdev",
    fixtureDisplayName: "dbdev",
    scenarioName: "progressive",
    artifactId: "step-0001",
    image: "supabase/postgres:15.14.1.018",
    step: 1,
    migrationName: "20220117141357_extensions.sql",
    errorMessage: "simulated failure",
    reproCommand:
      "PGDELTA_TEST_POSTGRES_VERSIONS=15 bun run test tests/integration/supabase-project-progressive.test.ts",
    planSql: "CREATE TABLE public.example (id integer);",
    remainingSql: "ALTER TABLE public.example ADD COLUMN name text;",
    sourceCatalog: { schemas: ["public"] },
    targetCatalog: { schemas: ["public", "app"] },
    candidateRegressionNote: "Shrink the fixture to the smallest prefix first.",
  });

  expect(result.reportPath).toContain("report.md");
  expect(await Bun.file(result.reportPath).exists()).toBe(true);
  expect(await Bun.file(path.join(result.directory, "metadata.json")).exists()).toBe(
    true,
  );
  expect(await Bun.file(path.join(result.directory, "plan.sql")).exists()).toBe(
    true,
  );
  expect(await Bun.file(path.join(result.directory, "remaining.sql")).exists()).toBe(
    true,
  );

  const report = await readFile(result.reportPath, "utf-8");
  expect(report).toContain("## Summary");
  expect(report).toContain("simulated failure");
  expect(report).toContain("Shrink the fixture to the smallest prefix first.");

  const metadata = JSON.parse(
    await readFile(path.join(result.directory, "metadata.json"), "utf-8"),
  );
  expect(metadata.fixtureId).toBe("dbdev");
  expect(metadata.scenarioName).toBe("progressive");
});
