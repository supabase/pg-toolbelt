import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { normalizeCliOutput } from "./helpers/normalize-cli-output.ts";
import { runCli } from "./helpers/run-cli.ts";

const packageRoot = join(import.meta.dir, "..", "..");
const baselineSnapshotPath = join(
  packageRoot,
  "src",
  "core",
  "fixtures",
  "empty-catalogs",
  "postgres-15-16-baseline.json",
);
const unsafePlanPath = join(
  packageRoot,
  "tests",
  "fixtures",
  "cli",
  "offline",
  "unsafe-drop.plan.json",
);
const invalidPlanPath = join(
  packageRoot,
  "tests",
  "fixtures",
  "cli",
  "offline",
  "invalid.plan.json",
);
const emptyDeclarativeDirPath = join(
  packageRoot,
  "tests",
  "fixtures",
  "cli",
  "declarative",
  "empty",
);

async function makeTargetSnapshotFixture(): Promise<{
  readonly tempDir: string;
  readonly targetSnapshotPath: string;
}> {
  const tempDir = await mkdtemp(join(tmpdir(), "pgdelta-cli-offline-"));
  const targetSnapshotPath = join(tempDir, "target-app.snapshot.json");
  const baseline = JSON.parse(await readFile(baselineSnapshotPath, "utf8")) as {
    schemas: Record<string, unknown>;
  };

  baseline.schemas["schema:app"] = {
    name: "app",
    owner: "postgres",
    comment: null,
    privileges: [],
  };

  await writeFile(targetSnapshotPath, `${JSON.stringify(baseline, null, 2)}\n`);

  return { tempDir, targetSnapshotPath };
}

describe("pgdelta CLI entrypoint", () => {
  test("bare root help does not leak internal Effect causes", async () => {
    const result = await runCli([]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
"USAGE
  pgdelta <subcommand> [flags]

GLOBAL FLAGS
  --help, -h              Show help information
  --version               Show version information
  --completions <bash|zsh|fish|sh>
                          Print shell completion script
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>
                          Sets the minimum log level

SUBCOMMANDS
  plan              
  apply             
  sync              
  declarative       
  catalog-export    
"
`);
    expect(result.stderr).toMatchInlineSnapshot(`""`);
  });

  test("version prints a semantic version string", async () => {
    const result = await runCli(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^pgdelta v\d+\.\d+\.\d+[^\n]*\n?$/);
    expect(result.stderr).toBe("");
  });

  test("bare completions prints a targeted error", async () => {
    const result = await runCli(["--completions"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(result.stderr).toMatchInlineSnapshot(`
"Missing value for --completions. Supported shells: bash, zsh, fish, sh.
"
`);
  });

  for (const [shell, marker] of [
    ["bash", "complete -F _pgdelta pgdelta"],
    ["zsh", "#compdef pgdelta"],
    ["fish", "complete -c pgdelta"],
    ["sh", "complete -F _pgdelta pgdelta"],
  ] as const) {
    test(`${shell} completions expose shell markers without invalid negated flags`, async () => {
      const result = await runCli(["--completions", shell]);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(marker);
      expect(result.stdout).not.toContain("--no-unsafe");
      expect(result.stdout).not.toContain("--no-force");
      expect(result.stdout).not.toContain("--no-verbose");
      expect(result.stdout).not.toContain("--no-skip-function-validation");
    });
  }

  test("unsupported completions shell prints a targeted error", async () => {
    const result = await runCli(["--completions", "bogus"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(result.stderr).toMatchInlineSnapshot(`
"Unsupported shell for --completions. Supported shells: bash, zsh, fish, sh.
"
`);
  });

  test("unknown subcommand prints help and suggestions without leaking internals", async () => {
    const result = await runCli(["plna"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("pgdelta <subcommand> [flags]");
    expect(result.stderr).toMatchInlineSnapshot(`
"
ERROR
  Unknown subcommand "plna" for "pgdelta"

  Did you mean this?
    plan
"
`);
  });

  test("root sync flags produce a readable explicit-command error", async () => {
    const result = await runCli(["--source", "postgres://a", "--target", "postgres://b"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("pgdelta <subcommand> [flags]");
    expect(result.stderr).toContain("Unrecognized flag: --source");
    expect(result.stderr).toContain('Unknown subcommand "postgres://a"');
    expect(result.stderr).not.toContain("Root-level sync flags are not supported");
    expect(result.stderr).not.toContain("Cause(");
  });

  test("plan on identical snapshots reports no changes", async () => {
    const result = await runCli([
      "plan",
      "--source",
      baselineSnapshotPath,
      "--target",
      baselineSnapshotPath,
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(result.stderr).toMatchInlineSnapshot(`
"No changes detected.
"
`);
  });

  test("plan with default output prints the tree format contract", async () => {
    const { targetSnapshotPath } = await makeTargetSnapshotFixture();
    const result = await runCli([
      "plan",
      "--source",
      baselineSnapshotPath,
      "--target",
      targetSnapshotPath,
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchInlineSnapshot(`
"📋 Migration Plan: 1 change

Entity  Create  Alter  Drop
------  ------  -----  ----
schema       1      -     -

Plan
└ schemas  +1
   + app

+ create   ~ alter   - drop
"
`);
    expect(result.stderr).toBe("");
  });

  test("plan --format sql prints SQL and exits with changes-detected", async () => {
    const { targetSnapshotPath } = await makeTargetSnapshotFixture();
    const result = await runCli([
      "plan",
      "--source",
      baselineSnapshotPath,
      "--target",
      targetSnapshotPath,
      "--format",
      "sql",
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchInlineSnapshot(`
"-- Risk: safe
CREATE SCHEMA app AUTHORIZATION postgres;
"
`);
    expect(result.stderr).toMatchInlineSnapshot(`""`);
  });

  test("plan --output writes the plan artifact and still exits with changes-detected", async () => {
    const { tempDir, targetSnapshotPath } = await makeTargetSnapshotFixture();
    const outputPath = join(tempDir, "plan.json");
    const result = await runCli([
      "plan",
      "--source",
      baselineSnapshotPath,
      "--target",
      targetSnapshotPath,
      "--output",
      outputPath,
    ]);

    const planJson = JSON.parse(await readFile(outputPath, "utf8"));

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(
      normalizeCliOutput(result.stderr, {
        [outputPath]: "<PLAN_PATH>",
      }),
    ).toMatchInlineSnapshot(`
"Plan written to <PLAN_PATH>
"
`);
    expect(planJson).toMatchInlineSnapshot(`
{
  "risk": {
    "level": "safe",
  },
  "source": {
    "fingerprint": "c5657f87909692e148096d5c8fff41b4d2c21e8272d32ab97b8bcf92c192e4d6",
  },
  "statements": [
    "CREATE SCHEMA app AUTHORIZATION postgres",
  ],
  "target": {
    "fingerprint": "79357a6dd2273fd4f0018722ec09a3769956f96a3b4270e686ab722753572239",
  },
  "version": 1,
}
`);
  });

  test("plan surfaces malformed filter JSON clearly", async () => {
    const result = await runCli([
      "plan",
      "--target",
      baselineSnapshotPath,
      "--filter",
      "{",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(result.stderr).toMatchInlineSnapshot(`
"Invalid filter JSON: JSON Parse error: Expected '}'
"
`);
  });

  test("plan rejects unknown flags with a clean parse error", async () => {
    const result = await runCli(["plan", "--bogus"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("USAGE");
    expect(result.stderr).toMatchInlineSnapshot(`
"
ERROR
  Unrecognized flag: --bogus in command pgdelta plan
"
`);
  });

  test("plan without --target prints the missing required flag error", async () => {
    const result = await runCli(["plan"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("USAGE");
    expect(result.stderr).toMatchInlineSnapshot(`
"
ERROR
  Missing required flag: --target
"
`);
  });

  test("invalid --log-level is reported without leaking Effect internals", async () => {
    const result = await runCli([
      "plan",
      "--target",
      baselineSnapshotPath,
      "--log-level",
      "bogus",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(result.stderr).toContain(
      'Invalid value for flag --log-level: "bogus". Expected:',
    );
    expect(result.stderr).toContain('"all" | "trace" | "debug"');
    expect(result.stderr).not.toContain("Cause(");
    expect(result.stderr).not.toContain("Param.js:");
    expect(result.stderr).not.toContain("at <anonymous>");
  });

  test("plan surfaces missing snapshot files clearly", async () => {
    const result = await runCli([
      "plan",
      "--target",
      join(packageRoot, "tests", "fixtures", "cli", "offline", "missing.snapshot.json"),
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(result.stderr).toContain("Error loading target catalog:");
    expect(result.stderr).toContain("missing.snapshot.json");
  });

  test("apply rejects unsafe plans before any database connection is attempted", async () => {
    const result = await runCli([
      "apply",
      "--plan",
      unsafePlanPath,
      "--source",
      "postgresql://ignored/source",
      "--target",
      "postgresql://ignored/target",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(result.stderr).toMatchInlineSnapshot(`
"Data-loss operations detected:
- DROP TABLE public.users;
Use \`--unsafe\` to allow applying these operations.
Data-loss operations detected. Re-run with --unsafe to allow applying this plan.
"
`);
  });

  test("apply surfaces invalid plan files clearly", async () => {
    const result = await runCli([
      "apply",
      "--plan",
      invalidPlanPath,
      "--source",
      "postgresql://ignored/source",
      "--target",
      "postgresql://ignored/target",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(result.stderr).toMatchInlineSnapshot(`
"Error parsing plan file: Missing key
  at ["version"]
"
`);
  });

  test("declarative apply on an empty directory reports no sql files", async () => {
    const result = await runCli([
      "declarative",
      "apply",
      "--path",
      emptyDeclarativeDirPath,
      "--target",
      "postgresql://ignored/target",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatchInlineSnapshot(`""`);
    expect(
      normalizeCliOutput(result.stderr, {
        [emptyDeclarativeDirPath]: "<EMPTY_DIR>",
      }),
    ).toMatchInlineSnapshot(`
"Analyzing SQL files in <EMPTY_DIR>...
No .sql files found in '<EMPTY_DIR>'. Pass a directory containing .sql files or a single .sql file.
"
`);
  });

  test("declarative export --dry-run previews output without writing files", async () => {
    const { tempDir, targetSnapshotPath } = await makeTargetSnapshotFixture();
    const outputDir = join(tempDir, "schema");
    const result = await runCli([
      "declarative",
      "export",
      "--source",
      baselineSnapshotPath,
      "--target",
      targetSnapshotPath,
      "--output",
      outputDir,
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
"schema
  └── schemas
    └── app
      └── + schema.sql
+ created   ~ updated   - deleted
"
`);
    expect(
      normalizeCliOutput(result.stderr, {
        [outputDir]: "<SCHEMA_DIR>",
      }),
    ).toMatchInlineSnapshot(`
"Would create: 1 file(s)
Changes: 1 | Files: 1 | Statements: 1

(dry-run: no files written)

Tip: To apply this schema to an empty database, run:
  pgdelta declarative apply --path <SCHEMA_DIR> --target <database_url>
"
`);
  });

  test("declarative export writes files and prints the success contract", async () => {
    const { tempDir, targetSnapshotPath } = await makeTargetSnapshotFixture();
    const outputDir = join(tempDir, "schema");
    const result = await runCli([
      "declarative",
      "export",
      "--source",
      baselineSnapshotPath,
      "--target",
      targetSnapshotPath,
      "--output",
      outputDir,
    ]);

    const schemaFile = await readFile(
      join(outputDir, "schemas", "app", "schema.sql"),
      "utf8",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchInlineSnapshot(`
"schema
  └── schemas
    └── app
      └── + schema.sql
+ created   ~ updated   - deleted
"
`);
    expect(
      normalizeCliOutput(result.stderr, {
        [outputDir]: "<SCHEMA_DIR>",
      }),
    ).toMatchInlineSnapshot(`
"Created: 1 file(s)
Changes: 1 | Files: 1 | Statements: 1
Wrote 1 file(s) to <SCHEMA_DIR>
Tip: To apply this schema to an empty database, run:
  pgdelta declarative apply --path <SCHEMA_DIR> --target <database_url>
"
`);
    expect(schemaFile).toContain("CREATE SCHEMA app AUTHORIZATION postgres;");
  });

  test("declarative export validates group-patterns JSON shape", async () => {
    const { tempDir, targetSnapshotPath } = await makeTargetSnapshotFixture();
    const outputDir = join(tempDir, "schema");
    const result = await runCli([
      "declarative",
      "export",
      "--source",
      baselineSnapshotPath,
      "--target",
      targetSnapshotPath,
      "--output",
      outputDir,
      "--group-patterns",
      "{}",
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatchInlineSnapshot(`
"group-patterns must be a JSON array
"
`);
  });

  test("declarative apply help exposes the renamed canonical validation flag", async () => {
    const result = await runCli(["declarative", "apply", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--skip-function-validation");
    expect(result.stdout).not.toContain("--no-validate-functions");
    expect(result.stderr).toMatchInlineSnapshot(`""`);
  });
});
