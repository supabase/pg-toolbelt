import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Pool } from "pg";
import { GenericContainer, Wait } from "testcontainers";
import { createPool, endPool } from "../src/core/postgres-config.ts";
import {
  POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG,
  SUPABASE_POSTGRES_VERSIONS,
  type SupabasePostgresVersion,
} from "../tests/constants.ts";
import { SupabasePostgreSqlContainer } from "../tests/supabase-postgres.js";
import { applySupabaseBaseInit } from "../tests/utils.ts";

/**
 * Maintainer workflow for regenerating the "base init" SQL replayed by
 * Supabase-isolated integration tests.
 *
 * For each supported Postgres major version we:
 * 1. start a temporary `supabase start` project pinned to the exact image tag
 * 2. start a bare `supabase/postgres` container for the same tag
 * 3. diff bare -> full stack with `pgdelta plan` and persist that SQL
 * 4. replay the generated SQL into a fresh test-style Supabase container
 * 5. require a final zero-diff validation against the full stack
 *
 * This keeps the committed fixtures in sync with image upgrades and proves that
 * the same SQL our tests replay is sufficient to reach the full-stack schema.
 */
const SUPABASE_BASE_INIT_FIXTURE_DIRECTORY =
  "tests/integration/fixtures/supabase-base-init";

const POSTGRES_PORT = 5432;
// `supabase start` always exposes the database on 54322 inside the temporary
// local project; we patch the project config to control which major version/tag
// that local stack boots with.
const SUPABASE_LOCAL_DB_URL =
  "postgres://postgres:postgres@127.0.0.1:54322/postgres";
const pkgRoot = join(import.meta.dir, "..");
const supabaseBin = join(
  pkgRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "supabase.cmd" : "supabase",
);

export function ensureSupabaseDbMajorVersion(
  configToml: string,
  majorVersion: number,
): string {
  // Supabase CLI owns the surrounding TOML, so keep the patch deliberately
  // small: replace or inject only `[db].major_version` and preserve the rest.
  const newline = configToml.includes("\r\n") ? "\r\n" : "\n";
  const lines = configToml.split(/\r?\n/);
  const dbSectionIndex = lines.findIndex((line) => line.trim() === "[db]");

  if (dbSectionIndex === -1) {
    throw new Error("Supabase config is missing a [db] section");
  }

  let nextSectionIndex = lines.findIndex(
    (line, index) =>
      index > dbSectionIndex &&
      line.trim().startsWith("[") &&
      line.trim().endsWith("]"),
  );

  if (nextSectionIndex === -1) {
    nextSectionIndex = lines.length;
  }

  const majorVersionLineIndex = lines.findIndex(
    (line, index) =>
      index > dbSectionIndex &&
      index < nextSectionIndex &&
      line.trim().startsWith("major_version"),
  );

  if (majorVersionLineIndex === -1) {
    lines.splice(dbSectionIndex + 1, 0, `major_version = ${majorVersion}`);
  } else {
    lines[majorVersionLineIndex] = `major_version = ${majorVersion}`;
  }

  return lines.join(newline);
}

export function buildPgdeltaPlanCommand(options: {
  source: string;
  target: string;
  format?: "sql" | "json";
  output?: string;
  sqlFormat?: boolean;
}): string[] {
  // Use the public CLI entrypoint even though this script lives inside the repo:
  // the goal is to validate the real maintainer workflow, not just the internals.
  const command = [
    "bun",
    "run",
    "pgdelta",
    "plan",
    "--source",
    options.source,
    "--target",
    options.target,
  ];

  if (options.format) {
    command.push("--format", options.format);
  }

  if (options.output) {
    command.push("--output", options.output);
  }

  if (options.sqlFormat) {
    command.push("--sql-format");
  }

  return command;
}

export function getSupabaseBaseInitFixtureRelativePath(
  version: number,
): string {
  return `${SUPABASE_BASE_INIT_FIXTURE_DIRECTORY}/${version}_fullstack_container_init.sql`;
}

async function runCommand(options: {
  cmd: string[];
  cwd: string;
  allowedExitCodes?: number[];
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: options.cmd,
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const allowedExitCodes = options.allowedExitCodes ?? [0];
  if (!allowedExitCodes.includes(exitCode)) {
    // Bubble up full stdout/stderr because most failures here come from external
    // tools (Supabase CLI, Docker, pgdelta) where the captured command output is
    // the primary debugging signal.
    const commandLabel = options.cmd.join(" ");
    throw new Error(
      `Command failed with exit code ${exitCode}: ${commandLabel}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
  }

  return { stdout, stderr, exitCode };
}

async function waitForPool(
  pool: Pool,
  retries = 30,
  delayMs = 2_000,
): Promise<void> {
  // Container/CLI health checks can turn green before the database is actually
  // ready to accept application connections. Poll the real connection path we
  // will use for diffing/replay before moving to the next phase.
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch (error) {
      if (attempt === retries - 1) {
        throw new Error(
          `Pool not ready after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      await Bun.sleep(delayMs);
    }
  }
}

function createManagedPool(connectionString: string): Pool {
  // The sync workflow starts and stops a lot of ephemeral containers. These two
  // errors are expected during teardown and shouldn't hide the real failure.
  return createPool(connectionString, {
    connectionTimeoutMillis: 20_000,
    onError: (err: Error & { code?: string }) => {
      if (err.code === "57P01" || err.code === "53100") return;
      console.error("Pool error:", err);
    },
  });
}

async function stopSupabaseStack(workdir: string): Promise<void> {
  try {
    await runCommand({
      cmd: [supabaseBin, "stop", "--yes", "--no-backup", "--workdir", workdir],
      cwd: pkgRoot,
      allowedExitCodes: [0],
    });
  } catch (error) {
    // Cleanup should not mask the original generation/validation error.
    console.warn(
      `[sync-base-images] Failed to stop Supabase stack for ${workdir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function prepareSupabaseProject(
  workdir: string,
  postgresVersion: SupabasePostgresVersion,
): Promise<void> {
  await runCommand({
    cmd: [supabaseBin, "init", "--yes", "--workdir", workdir],
    cwd: pkgRoot,
  });

  const supabaseDir = join(workdir, "supabase");
  const configPath = join(supabaseDir, "config.toml");
  const configToml = await readFile(configPath, "utf-8");

  await writeFile(
    configPath,
    ensureSupabaseDbMajorVersion(configToml, postgresVersion),
    "utf-8",
  );

  // The CLI uses this temp file to pick the exact Postgres image tag. Without
  // it we would only pin the major version, not the concrete image build our
  // tests use from `tests/constants.ts`.
  await mkdir(join(supabaseDir, ".temp"), { recursive: true });
  await writeFile(
    join(supabaseDir, ".temp", "postgres-version"),
    `${POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion]}\n`,
    "utf-8",
  );
}

type BareSupabaseContainer = {
  connectionUri: string;
  stop: () => Promise<void>;
};

/**
 * Build the connection URL for the local `supabase start` stack as a specific
 * database role.
 *
 * This matters because pg-delta diffs are sensitive to `current_user` for some
 * Supabase-managed grants/comments/default-privilege cases.
 */
function buildLocalSupabaseUrl(username: string): string {
  // `current_user` affects grants/comments/default privilege diffs for Supabase
  // objects, so both generation and validation must use the same login role as
  // the path they are comparing against.
  const url = new URL(SUPABASE_LOCAL_DB_URL);
  url.username = username;
  url.password = "postgres";
  return url.toString();
}

/**
 * Rewrite a connection string to log in as the requested role.
 *
 * We use this for the bare comparison container because the container itself is
 * started with the stock `postgres` bootstrap user, but the diff must run as
 * the same role that the full local Supabase stack exposes to us during tests
 * and validation (`supabase_admin`).
 */
function buildConnectionUrlForUser(
  connectionUri: string,
  username: string,
): string {
  // The bare comparison container starts as `postgres`, but we diff it as
  // `supabase_admin` to match the local Supabase stack and the test runtime.
  const url = new URL(connectionUri);
  url.username = username;
  url.password = "postgres";
  return url.toString();
}

async function startBareSupabaseContainer(
  postgresVersion: SupabasePostgresVersion,
): Promise<BareSupabaseContainer> {
  const tag = POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion];
  // Start the raw image with the stock Docker entrypoint. This is the "before"
  // side of the diff: just the base Postgres image, before the rest of the
  // Supabase services have bootstrapped their own schemas and tables.
  const startedContainer = await new GenericContainer(
    `supabase/postgres:${tag}`,
  )
    .withLabels({ "pg-toolbelt.package": "pg-delta" })
    .withExposedPorts(POSTGRES_PORT)
    .withStartupTimeout(120_000)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections"),
    )
    .withEnvironment({
      POSTGRES_PASSWORD: "postgres",
    })
    .start();

  const url = new URL("", "postgres://");
  url.hostname = "127.0.0.1";
  url.port = startedContainer.getMappedPort(POSTGRES_PORT).toString();
  url.pathname = "postgres";
  url.username = "postgres";
  url.password = "postgres";

  return {
    connectionUri: url.toString(),
    stop: async () => {
      // Normalize teardown to `Promise<void>` so the orchestration code can
      // treat both bare and validated containers the same way.
      await startedContainer.stop();
    },
  };
}

/**
 * Start a Supabase container using the same wrapper as the test suite.
 *
 * Validation uses this container shape, not the raw GenericContainer above, so
 * that the generated SQL is proven against the exact startup path used by
 * `withDbSupabaseIsolated(...)`.
 */
async function startValidatedSupabaseContainer(
  postgresVersion: SupabasePostgresVersion,
): Promise<BareSupabaseContainer> {
  const tag = POSTGRES_VERSION_TO_SUPABASE_POSTGRES_TAG[postgresVersion];
  // Validation intentionally uses the same container wrapper as the test suite.
  // If zero-diff passes here, we know the generated SQL is valid for the actual
  // runtime path used by `withDbSupabaseIsolated(...)`, not just for a custom
  // one-off container shape in this script.
  const startedContainer = await new SupabasePostgreSqlContainer(
    `supabase/postgres:${tag}`,
  ).start();

  return {
    connectionUri: startedContainer.getConnectionUri(),
    stop: async () => {
      // Match the bare-container helper above: callers only care that teardown
      // completes, not about the stopped-container object that testcontainers
      // returns.
      await startedContainer.stop();
    },
  };
}

/**
 * Generate and validate the replay SQL for one Postgres major version.
 *
 * The important distinction in this flow is:
 * - bare container: "just the image"
 * - full stack: `supabase start` after the other services have initialized it
 * - validated container: a fresh test-style container after replaying the SQL
 *
 * If the validated container still diffs against the full stack, the generated
 * fixture is incomplete and the script must fail.
 */
async function generateFixtureForVersion(
  postgresVersion: SupabasePostgresVersion,
): Promise<void> {
  const workdir = await mkdtemp(
    join(tmpdir(), `pg-delta-supabase-sync-pg${postgresVersion}-`),
  );
  const fixtureRelativePath =
    getSupabaseBaseInitFixtureRelativePath(postgresVersion);
  const fixturePath = join(pkgRoot, fixtureRelativePath);

  let fullstackPool: Pool | undefined;
  let fullstackValidationPool: Pool | undefined;
  let barePool: Pool | undefined;
  let validatedPool: Pool | undefined;
  let bareContainer:
    | Awaited<ReturnType<typeof startBareSupabaseContainer>>
    | undefined;
  let validatedContainer:
    | Awaited<ReturnType<typeof startBareSupabaseContainer>>
    | undefined;

  try {
    console.log(
      `[sync-base-images] Preparing Supabase project for pg${postgresVersion}`,
    );
    await prepareSupabaseProject(workdir, postgresVersion);

    // Bring up the full local stack first so the target side of the diff reflects
    // every service-owned migration that `supabase start` applies on boot.
    console.log(
      `[sync-base-images] Starting full stack for pg${postgresVersion}`,
    );
    await runCommand({
      cmd: [supabaseBin, "start", "--yes", "--workdir", workdir],
      cwd: pkgRoot,
    });

    fullstackPool = createManagedPool(SUPABASE_LOCAL_DB_URL);
    console.log(`[sync-base-images] Waiting for full stack database readiness`);
    await waitForPool(fullstackPool);

    console.log(
      `[sync-base-images] Starting bare supabase/postgres container for pg${postgresVersion}`,
    );
    bareContainer = await startBareSupabaseContainer(postgresVersion);
    barePool = createManagedPool(bareContainer.connectionUri);
    console.log(
      `[sync-base-images] Waiting for bare container readiness at ${bareContainer.connectionUri}`,
    );
    await waitForPool(barePool);

    await mkdir(dirname(fixturePath), { recursive: true });
    console.log(`[sync-base-images] Generating ${fixtureRelativePath}`);
    // Generate the replay SQL by diffing the bare image against the fully
    // bootstrapped local stack. Allow exit code 2 here because `pgdelta plan`
    // uses it to signal "changes detected", which is exactly what we want.
    const bareDiffUrl = buildConnectionUrlForUser(
      bareContainer.connectionUri,
      "supabase_admin",
    );
    await runCommand({
      cmd: buildPgdeltaPlanCommand({
        source: bareDiffUrl,
        target: buildLocalSupabaseUrl("supabase_admin"),
        output: fixturePath,
        sqlFormat: true,
      }),
      cwd: pkgRoot,
      allowedExitCodes: [0, 2],
    });

    console.log(
      `[sync-base-images] Validating generated fixture for pg${postgresVersion}`,
    );
    validatedContainer = await startValidatedSupabaseContainer(postgresVersion);
    validatedPool = createManagedPool(validatedContainer.connectionUri);
    console.log(
      `[sync-base-images] Waiting for validated container readiness at ${validatedContainer.connectionUri}`,
    );
    await waitForPool(validatedPool);
    // Replay the committed fixture through the same helper exported to tests.
    // This guarantees that script validation and test runtime share the exact
    // same "post-start" setup behavior.
    await applySupabaseBaseInit(validatedPool, postgresVersion);

    // Compare as `supabase_admin` on both sides. The remaining diff here is the
    // exact signal we care about: "does the test runtime baseline match the
    // stack that `supabase start` produced?"
    fullstackValidationPool = createManagedPool(
      buildLocalSupabaseUrl("supabase_admin"),
    );
    await waitForPool(fullstackValidationPool);

    // Final contract of this script: after replaying the generated SQL into a
    // fresh test-style container, `pgdelta plan` must report no remaining diff.
    // If this exits 2, the fixture is incomplete and the script fails.
    await runCommand({
      cmd: buildPgdeltaPlanCommand({
        source: validatedContainer.connectionUri,
        target: buildLocalSupabaseUrl("supabase_admin"),
        format: "sql",
        sqlFormat: true,
      }),
      cwd: pkgRoot,
      allowedExitCodes: [0],
    });
  } finally {
    await Promise.all([
      barePool ? endPool(barePool) : Promise.resolve(),
      validatedPool ? endPool(validatedPool) : Promise.resolve(),
      fullstackValidationPool
        ? endPool(fullstackValidationPool)
        : Promise.resolve(),
      fullstackPool ? endPool(fullstackPool) : Promise.resolve(),
    ]);
    await Promise.all([
      bareContainer ? bareContainer.stop() : Promise.resolve(),
      validatedContainer ? validatedContainer.stop() : Promise.resolve(),
    ]);
    // Always tear down the temporary CLI project, even after generation or
    // validation failures, so reruns start from a clean slate.
    await stopSupabaseStack(workdir);
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function syncSupabaseBaseImages(): Promise<void> {
  await access(supabaseBin);

  // Keep fixture generation serialized by version to avoid multiple local
  // Supabase stacks fighting over the CLI's fixed localhost ports.
  for (const postgresVersion of SUPABASE_POSTGRES_VERSIONS) {
    await generateFixtureForVersion(postgresVersion);
  }
}

if (import.meta.main) {
  await syncSupabaseBaseImages().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
