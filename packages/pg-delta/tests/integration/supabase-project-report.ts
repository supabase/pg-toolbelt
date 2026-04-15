import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type SupabaseSmokeScenarioName =
  | "declarative"
  | "progressive"
  | "adjacent";

export type WriteSupabaseSmokeFailureArtifactsInput = {
  baseDir?: string;
  fixtureId: string;
  fixtureDisplayName: string;
  scenarioName: SupabaseSmokeScenarioName;
  artifactId?: string;
  image: string;
  step?: number;
  migrationName?: string;
  errorMessage: string;
  reproCommand: string;
  skippedMigrations?: string[];
  planSql?: string;
  remainingSql?: string;
  sourceCatalog?: unknown;
  targetCatalog?: unknown;
  candidateRegressionNote?: string;
};

export type SupabaseSmokeFailureArtifacts = {
  directory: string;
  reportPath: string;
};

const DEFAULT_RESULTS_DIR = path.join(
  import.meta.dir,
  "..",
  "..",
  "test-results",
  "supabase-smoke",
);

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function createArtifactId(input: WriteSupabaseSmokeFailureArtifactsInput): string {
  if (input.artifactId) {
    return sanitizeSegment(input.artifactId);
  }

  const stepLabel =
    input.step !== undefined ? `step-${String(input.step).padStart(4, "0")}` : "step-na";
  const migrationLabel = input.migrationName
    ? sanitizeSegment(input.migrationName.replace(/\.sql$/i, ""))
    : "migration-na";
  return `${stepLabel}-${migrationLabel}`;
}

function buildMarkdown(
  input: WriteSupabaseSmokeFailureArtifactsInput,
  directory: string,
): string {
  const sections = [
    "# Supabase Smoke Failure",
    "",
    "## Summary",
    `- Fixture: \`${input.fixtureDisplayName}\``,
    `- Scenario: \`${input.scenarioName}\``,
    `- Image: \`${input.image}\``,
    input.step !== undefined ? `- Step: \`${input.step}\`` : "",
    input.migrationName ? `- Migration: \`${input.migrationName}\`` : "",
    "",
    "## Error",
    "```text",
    input.errorMessage,
    "```",
    "",
    "## Repro",
    "```bash",
    input.reproCommand,
    "```",
    "",
    input.skippedMigrations && input.skippedMigrations.length > 0
      ? ["## Skipped Migrations", "```text", ...input.skippedMigrations, "```", ""].join(
          "\n",
        )
      : "",
    input.planSql
      ? ["## Plan SQL", "```sql", input.planSql, "```", ""].join("\n")
      : "",
    input.remainingSql
      ? ["## Remaining SQL", "```sql", input.remainingSql, "```", ""].join("\n")
      : "",
    input.candidateRegressionNote
      ? [
          "## Candidate Regression Test",
          input.candidateRegressionNote,
          "",
        ].join("\n")
      : "",
    "## Artifact Files",
    `- Directory: \`${directory}\``,
    "- `metadata.json`",
    input.planSql ? "- `plan.sql`" : "",
    input.remainingSql ? "- `remaining.sql`" : "",
    input.sourceCatalog ? "- `source-catalog.json`" : "",
    input.targetCatalog ? "- `target-catalog.json`" : "",
  ];

  return sections.filter(Boolean).join("\n");
}

export async function writeSupabaseSmokeFailureArtifacts(
  input: WriteSupabaseSmokeFailureArtifactsInput,
): Promise<SupabaseSmokeFailureArtifacts> {
  const baseDir =
    input.baseDir ??
    process.env.PGDELTA_SUPABASE_SMOKE_REPORT_DIR ??
    DEFAULT_RESULTS_DIR;
  const directory = path.join(
    baseDir,
    sanitizeSegment(input.fixtureId),
    sanitizeSegment(input.scenarioName),
    createArtifactId(input),
  );

  await mkdir(directory, { recursive: true });

  const metadata = {
    fixtureId: input.fixtureId,
    fixtureDisplayName: input.fixtureDisplayName,
    scenarioName: input.scenarioName,
    image: input.image,
    step: input.step,
    migrationName: input.migrationName,
    errorMessage: input.errorMessage,
    reproCommand: input.reproCommand,
    skippedMigrations: input.skippedMigrations ?? [],
    candidateRegressionNote: input.candidateRegressionNote,
  };

  const reportPath = path.join(directory, "report.md");
  await Promise.all([
    writeFile(reportPath, buildMarkdown(input, directory), "utf-8"),
    writeFile(
      path.join(directory, "metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf-8",
    ),
    input.planSql
      ? writeFile(path.join(directory, "plan.sql"), `${input.planSql}\n`, "utf-8")
      : Promise.resolve(),
    input.remainingSql
      ? writeFile(
          path.join(directory, "remaining.sql"),
          `${input.remainingSql}\n`,
          "utf-8",
        )
      : Promise.resolve(),
    input.sourceCatalog
      ? writeFile(
          path.join(directory, "source-catalog.json"),
          `${JSON.stringify(input.sourceCatalog, null, 2)}\n`,
          "utf-8",
        )
      : Promise.resolve(),
    input.targetCatalog
      ? writeFile(
          path.join(directory, "target-catalog.json"),
          `${JSON.stringify(input.targetCatalog, null, 2)}\n`,
          "utf-8",
        )
      : Promise.resolve(),
  ]);

  return {
    directory,
    reportPath,
  };
}
