import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IntegrationDSL } from "../../src/core/integrations/integration-dsl.ts";
import {
  SUPABASE_POSTGRES_VERSIONS,
  type SupabasePostgresVersion,
} from "../constants.ts";

export type SupabaseProjectScenarioName =
  | "declarative"
  | "progressive"
  | "adjacent";

export type SupabaseProjectMigration = {
  filename: string;
  sql: string;
};

export type SupabaseProjectScenario = {
  include?: (filename: string) => boolean;
  onApplyError?: "fail" | "skip";
};

export type SupabaseProjectFixture = {
  id: string;
  displayName: string;
  supabasePostgresVersion: SupabasePostgresVersion;
  integration: IntegrationDSL;
  migrationsDir: string | URL;
  setRole?: string;
  skipDefaultPrivilegeSubtraction?: boolean;
  validateFunctionBodies?: boolean;
  candidateRegressionNote?: string;
  scenarios: Record<SupabaseProjectScenarioName, SupabaseProjectScenario>;
};

export const SUPABASE_PROJECTS_DIR = path.join(
  import.meta.dir,
  "fixtures/supabase-projects",
);

export function defineSupabaseProjectFixture(
  fixture: SupabaseProjectFixture,
): SupabaseProjectFixture {
  return fixture;
}

export function resolveSupabaseProjectPath(
  basePath: string | URL,
  ...parts: string[]
): string {
  const resolved =
    basePath instanceof URL ? fileURLToPath(basePath) : path.resolve(basePath);
  return parts.length > 0 ? path.join(resolved, ...parts) : resolved;
}

export async function discoverSupabaseProjectFixtures(): Promise<
  SupabaseProjectFixture[]
> {
  const selectedProject = process.env.PGDELTA_SUPABASE_PROJECT;
  const entries = await readdir(SUPABASE_PROJECTS_DIR, { withFileTypes: true });
  const fixtures: SupabaseProjectFixture[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;

    const projectFile = path.join(SUPABASE_PROJECTS_DIR, entry.name, "project.ts");
    if (!(await Bun.file(projectFile).exists())) {
      continue;
    }

    const module = await import(pathToFileURL(projectFile).href);
    const fixture = module.default as SupabaseProjectFixture;

    if (selectedProject && fixture.id !== selectedProject) {
      continue;
    }

    if (!SUPABASE_POSTGRES_VERSIONS.includes(fixture.supabasePostgresVersion)) {
      continue;
    }

    fixtures.push(fixture);
  }

  if (selectedProject && fixtures.length === 0) {
    throw new Error(
      `No Supabase project fixture matched PGDELTA_SUPABASE_PROJECT=${selectedProject}`,
    );
  }

  return fixtures;
}

export async function loadSupabaseProjectMigrations(
  fixture: SupabaseProjectFixture,
  scenarioName: SupabaseProjectScenarioName,
): Promise<SupabaseProjectMigration[]> {
  const migrationsDir = resolveSupabaseProjectPath(fixture.migrationsDir);
  const files = await readdir(migrationsDir);
  const scenario = fixture.scenarios[scenarioName];
  const sqlFiles = files
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .filter((file) => (scenario.include ? scenario.include(file) : true));

  return Promise.all(
    sqlFiles.map(async (filename) => ({
      filename,
      sql: await readFile(path.join(migrationsDir, filename), "utf-8"),
    })),
  );
}
