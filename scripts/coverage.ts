/**
 * Local coverage runner: runs pg-topo, pg-delta unit, and pg-delta integration
 * shards with Istanbul instrumentation, then generates reports via nyc.
 *
 * Usage: bun run coverage [--pg-versions 15,17] [--shards 12] [--skip-tests]
 *
 * Options:
 *   --pg-versions  Comma-separated PG versions for integration (default: 17)
 *   --shards       Number of integration shards (default: 12)
 *   --skip-tests   Use existing .nyc_output only; no test runs (report only)
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const nycOutputDir = join(repoRoot, ".nyc_output");
const reportDir = join(repoRoot, ".coverage-artifacts");
const pgDeltaRoot = join(repoRoot, "packages", "pg-delta");
const pgTopoRoot = join(repoRoot, "packages", "pg-topo");

function log(msg: string) {
  console.log(`\n=== ${msg} ===`);
}

function fail(msg: string): never {
  console.error(`\nFAIL: ${msg}`);
  process.exit(1);
}

async function run(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    stdout: "inherit",
    stderr: "inherit",
  });
  return proc.exited;
}

async function listPgDeltaTestFiles(): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, prefix: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = `${prefix}${e.name}`;
      if (e.isDirectory()) {
        await walk(join(dir, e.name), `${rel}/`);
      } else if (e.name.endsWith(".test.ts")) {
        files.push(rel);
      }
    }
  }
  await walk(join(pgDeltaRoot, "tests"), "tests/");
  files.sort();
  return files;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let pgVersions = [17];
  let shards = 12;
  let skipTests = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pg-versions" && args[i + 1]) {
      pgVersions = args[++i].split(",").map((v) => Number(v.trim()));
      if (pgVersions.some((v) => Number.isNaN(v)))
        fail("--pg-versions must be comma-separated numbers (e.g. 15,17)");
    } else if (args[i] === "--shards" && args[i + 1]) {
      shards = Number(args[++i]);
      if (Number.isNaN(shards) || shards < 1)
        fail("--shards must be a positive number");
    } else if (args[i] === "--skip-tests") {
      skipTests = true;
    }
  }

  return { pgVersions, shards, skipTests };
}

const coverageEnv = { BUN_COVERAGE: "1", NYC_OUTPUT_DIR: nycOutputDir };

async function main(): Promise<void> {
  const { pgVersions, shards, skipTests } = parseArgs();
  log("Options");
  console.log(`  pg-versions: ${pgVersions.join(", ")}`);
  console.log(`  shards: ${shards}`);
  console.log(`  skip-tests: ${skipTests}`);

  if (skipTests) {
    if (!existsSync(nycOutputDir)) {
      fail(
        ".nyc_output does not exist. Run without --skip-tests first to generate coverage data.",
      );
    }
    const files = await readdir(nycOutputDir);
    if (!files.some((f) => f.endsWith(".json"))) {
      fail(".nyc_output has no JSON files. Run without --skip-tests first.");
    }
  } else {
    await rm(nycOutputDir, { recursive: true, force: true });
    await mkdir(nycOutputDir, { recursive: true });

    log("Step 1: pg-topo");
    const topoExit = await run(["bun", "run", "test"], {
      cwd: pgTopoRoot,
      env: coverageEnv,
    });
    if (topoExit !== 0) fail("pg-topo tests failed");

    log("Step 2: pg-delta unit");
    const unitExit = await run(["bun", "run", "test:unit"], {
      cwd: pgDeltaRoot,
      env: coverageEnv,
    });
    if (unitExit !== 0) fail("pg-delta unit tests failed");

    log("Step 3: pg-delta integration shards");
    const allTestFiles = await listPgDeltaTestFiles();
    console.log(`  Total test files: ${allTestFiles.length}`);
    const failedShards: string[] = [];
    for (const pgVer of pgVersions) {
      for (let shardIndex = 1; shardIndex <= shards; shardIndex++) {
        const index0 = shardIndex - 1;
        const shardFiles = allTestFiles.filter((_, i) => i % shards === index0);
        const name = `pg${pgVer}-shard-${shardIndex}`;
        if (shardFiles.length === 0) continue;
        console.log(`  ${name}: ${shardFiles.length} files`);
        const shardExit = await run(["bun", "run", "test", ...shardFiles], {
          cwd: pgDeltaRoot,
          env: {
            ...coverageEnv,
            PGDELTA_TEST_POSTGRES_VERSIONS: String(pgVer),
          },
        });
        if (shardExit !== 0) failedShards.push(name);
      }
    }
    if (failedShards.length > 0) {
      console.warn(
        `\n  WARNING: ${failedShards.length} shard(s) failed: ${failedShards.join(", ")}`,
      );
    }
  }

  log("Generating coverage report");
  await rm(reportDir, { recursive: true, force: true });
  const nycExit = await run(["npx", "nyc", "report"], { cwd: repoRoot });
  if (nycExit !== 0) fail("nyc report failed");

  log("RESULT");
  console.log(`Coverage reports: ${reportDir}/`);
  console.log(`  HTML:  open ${reportDir}/index.html`);
  console.log(`  LCOV:  ${reportDir}/lcov.info`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
