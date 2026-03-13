import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { normalizeCliOutput } from "./helpers/normalize-cli-output.ts";
import { runCli } from "./helpers/run-cli.ts";
import { withDb } from "../utils.ts";

const packageRoot = join(import.meta.dir, "..", "..");
const functionValidationFixturePath = join(
  packageRoot,
  "tests",
  "fixtures",
  "cli",
  "declarative",
  "function-validation",
);
const unresolvedDeclarativeFixturePath = join(
  packageRoot,
  "tests",
  "fixtures",
  "cli",
  "declarative",
  "unresolved",
);
const CLI_E2E_TIMEOUT_MS = 20_000;

setDefaultTimeout(CLI_E2E_TIMEOUT_MS);

describe("pgdelta CLI e2e (pg17)", () => {
  test(
    "catalog-export -> plan -> apply completes an imperative workflow",
    withDb(17, async (db) => {
      const tempDir = await mkdtemp(join(tmpdir(), "pgdelta-cli-pg17-"));
      const snapshotPath = join(tempDir, "branch.snapshot.json");
      const planPath = join(tempDir, "plan.json");

      await db.branch.query("CREATE SCHEMA app");

      const exportResult = await runCli([
        "catalog-export",
        "--target",
        db.branchUrl,
        "--output",
        snapshotPath,
      ]);

      expect(exportResult.exitCode).toBe(0);
      expect(
        normalizeCliOutput(exportResult.stderr, {
          [snapshotPath]: "<SNAPSHOT_PATH>",
        }),
      ).toMatchInlineSnapshot(`
"Catalog snapshot written to <SNAPSHOT_PATH>
"
`);
      expect(JSON.parse(await readFile(snapshotPath, "utf8"))).toHaveProperty(
        "schemas",
      );

      const planResult = await runCli([
        "plan",
        "--source",
        db.mainUrl,
        "--target",
        snapshotPath,
        "--output",
        planPath,
      ]);

      expect(planResult.exitCode).toBe(2);
      expect(
        normalizeCliOutput(planResult.stderr, {
          [planPath]: "<PLAN_PATH>",
        }),
      ).toMatchInlineSnapshot(`
"Plan written to <PLAN_PATH>
"
`);

      const applyResult = await runCli([
        "apply",
        "--plan",
        planPath,
        "--source",
        db.mainUrl,
        "--target",
        db.branchUrl,
      ]);

      expect(applyResult.exitCode).toBe(0);
      expect(applyResult.stdout).toBe("");
      expect(applyResult.stderr).toContain(
        "Applying 1 changes to database...",
      );
      expect(applyResult.stderr).toContain("Successfully applied all changes.");
      const schemaExists = await db.main.query(
        "select 1 from pg_namespace where nspname = 'app'",
      );
      expect(schemaExists.rowCount).toBe(1);

      const rerunApply = await runCli([
        "apply",
        "--plan",
        planPath,
        "--source",
        db.mainUrl,
        "--target",
        db.branchUrl,
      ]);

      expect(rerunApply.exitCode).toBe(0);
      expect(rerunApply.stdout).toBe("");
      expect(rerunApply.stderr).toContain(
        "Plan already applied (target fingerprint matches desired state).",
      );
    }),
  );

  test(
    "sync supports cancellation, --yes apply, and idempotent rerun",
    withDb(17, async (db) => {
      await db.branch.query("CREATE SCHEMA sync_test");

      const cancelled = await runCli(
        ["sync", "--source", db.mainUrl, "--target", db.branchUrl],
        { stdin: "n\n" },
      );

      expect(cancelled.exitCode).toBe(2);
      expect(cancelled.stdout).toMatchInlineSnapshot(`
"📋 Migration Plan: 1 change

Entity  Create  Alter  Drop
------  ------  -----  ----
schema       1      -     -

Plan
└ schemas   +1
   + sync_test

+ create   ~ alter   - drop
Apply these changes (y/N) "
`);
      expect(cancelled.stderr).not.toContain("Cause(");

      const beforeApply = await db.main.query(
        "select 1 from pg_namespace where nspname = 'sync_test'",
      );
      expect(beforeApply.rowCount).toBe(0);

      const applied = await runCli([
        "sync",
        "--source",
        db.mainUrl,
        "--target",
        db.branchUrl,
        "--yes",
      ]);

      expect(applied.exitCode).toBe(0);
      expect(applied.stderr).toContain("Applying 1 changes to database...");
      expect(applied.stderr).toContain("Successfully applied all changes.");

      const afterApply = await db.main.query(
        "select 1 from pg_namespace where nspname = 'sync_test'",
      );
      expect(afterApply.rowCount).toBe(1);

      const rerun = await runCli([
        "sync",
        "--source",
        db.mainUrl,
        "--target",
        db.branchUrl,
        "--yes",
      ]);

      expect(rerun.exitCode).toBe(0);
      expect(rerun.stderr).toContain("No changes detected.");
    }),
  );

  test(
    "declarative export -> declarative apply round-trips a schema directory",
    withDb(17, async (db) => {
      const tempDir = await mkdtemp(join(tmpdir(), "pgdelta-cli-pg17-"));
      const outputDir = join(tempDir, "schema");

      await db.branch.query("CREATE SCHEMA declarative_app");

      const exportResult = await runCli([
        "declarative",
        "export",
        "--source",
        db.mainUrl,
        "--target",
        db.branchUrl,
        "--output",
        outputDir,
      ]);

      expect(exportResult.exitCode).toBe(0);

      const applyResult = await runCli([
        "declarative",
        "apply",
        "--path",
        outputDir,
        "--target",
        db.mainUrl,
      ]);

      expect(applyResult.exitCode).toBe(0);
      expect(applyResult.stdout).toBe("");
      expect(applyResult.stderr).toContain("Analyzing SQL files");
      expect(applyResult.stderr).toContain("Statements:");
      expect(applyResult.stderr).toContain("Rounds:");
      expect(applyResult.stderr).toContain("All statements applied successfully.");

      const schemaExists = await db.main.query(
        "select 1 from pg_namespace where nspname = 'declarative_app'",
      );
      expect(schemaExists.rowCount).toBe(1);
    }),
  );

  test(
    "apply surfaces fingerprint mismatch without leaking internals",
    withDb(17, async (db) => {
      const tempDir = await mkdtemp(join(tmpdir(), "pgdelta-cli-pg17-"));
      const planPath = join(tempDir, "plan.json");

      await db.branch.query("CREATE SCHEMA changed_branch");

      const planResult = await runCli([
        "plan",
        "--source",
        db.mainUrl,
        "--target",
        db.branchUrl,
        "--output",
        planPath,
      ]);

      expect(planResult.exitCode).toBe(2);

      await db.main.query("CREATE SCHEMA drifted_source");

      const applyResult = await runCli([
        "apply",
        "--plan",
        planPath,
        "--source",
        db.mainUrl,
        "--target",
        db.branchUrl,
      ]);

      expect(applyResult.exitCode).toBe(1);
      expect(applyResult.stdout).toBe("");
      expect(applyResult.stderr).not.toContain("Cause(");
      expect(
        normalizeCliOutput(applyResult.stderr, {
          [planPath]: "<PLAN_PATH>",
        }),
      ).toMatchInlineSnapshot(`
"Target database does not match plan source fingerprint. Aborting.
"
`);

      expect(JSON.parse(await readFile(planPath, "utf8"))).toHaveProperty("risk");
    }),
  );

  test(
    "declarative apply --verbose surfaces diagnostic-oriented stderr without snapshots",
    withDb(17, async (db) => {
      const result = await runCli([
        "declarative",
        "apply",
        "--path",
        unresolvedDeclarativeFixturePath,
        "--target",
        db.mainUrl,
        "--verbose",
      ]);

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toBe("");
      expect(
        normalizeCliOutput(result.stderr, {
          [unresolvedDeclarativeFixturePath]: "<UNRESOLVED_FIXTURE>",
        }),
      ).toContain("Analyzing SQL files in <UNRESOLVED_FIXTURE>...");
      expect(result.stderr).toContain("diagnostic(s) from static analysis");
      expect(result.stderr).toContain("[UNRESOLVED_DEPENDENCY]");
      expect(result.stderr).toContain("Stuck after");
    }),
  );

  test(
    "skip-function-validation changes the declarative apply outcome for broken functions",
    withDb(17, async (db) => {
      const withValidation = await runCli([
        "declarative",
        "apply",
        "--path",
        functionValidationFixturePath,
        "--target",
        db.mainUrl,
      ]);

      expect(withValidation.exitCode).toBe(1);
      expect(withValidation.stdout).toBe("");
      expect(withValidation.stderr).toContain(
        "function body validation error(s)",
      );

      const skippedValidation = await runCli([
        "declarative",
        "apply",
        "--path",
        functionValidationFixturePath,
        "--target",
        db.branchUrl,
        "--skip-function-validation",
      ]);

      expect(skippedValidation.exitCode).toBe(0);
      expect(skippedValidation.stdout).toBe("");
      expect(skippedValidation.stderr).toContain(
        "All statements applied successfully.",
      );
      expect(skippedValidation.stderr).not.toContain(
        "function body validation error(s)",
      );

      const createdFunction = await db.branch.query(
        "select 1 from pg_proc where proname = 'broken_users_count'",
      );
      expect(createdFunction.rowCount).toBe(1);
    }),
  );
});
