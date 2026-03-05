/**
 * Local coverage runner that mirrors CI: runs pg-topo, pg-delta unit, and
 * pg-delta integration shards, then merges (fix-lcov-paths, merge-lcov) and
 * generates HTML. With --skip-tests, uses existing .coverage-artifacts only.
 *
 * Usage: bun run coverage [--pg-versions 15,17] [--shards 12] [--skip-tests]
 *
 * Options:
 *   --pg-versions  Comma-separated PG versions for integration (default: 17)
 *   --shards       Number of integration shards (default: 12)
 *   --skip-tests   Use .coverage-artifacts only; no test runs (merge + genhtml)
 *
 * Prerequisites: genhtml (brew install lcov), Docker for integration tests
 */
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const EXPECTED_LCOV_VERSION = "2.4";
const repoRoot = resolve(import.meta.dir, "..");
const artifactDir = join(repoRoot, ".coverage-artifacts");
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
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    stdio?: "pipe" | "inherit";
  } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdio = opts.stdio ?? "pipe";
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    stdout: stdio === "inherit" ? "inherit" : "pipe",
    stderr: stdio === "inherit" ? "inherit" : "pipe",
  });
  if (stdio === "inherit") {
    const exitCode = await proc.exited;
    return { exitCode, stdout: "", stderr: "" };
  }
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const { exitCode } = await run(["which", cmd]);
    return exitCode === 0;
  } catch {
    return false;
  }
}

/** List packages/pg-delta test files as tests/... sorted (same as CI). */
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

function parseArgs(): {
  pgVersions: number[];
  shards: number;
  skipTests: boolean;
} {
  const args = process.argv.slice(2);
  let pgVersions = [17];
  let shards = 12;
  let skipTests = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--pg-versions" && args[i + 1]) {
      pgVersions = args[++i].split(",").map((v) => Number(v.trim()));
      if (pgVersions.some((v) => Number.isNaN(v))) {
        fail("--pg-versions must be comma-separated numbers (e.g. 15,17)");
      }
    } else if (args[i] === "--shards" && args[i + 1]) {
      shards = Number(args[++i]);
      if (Number.isNaN(shards) || shards < 1) {
        fail("--shards must be a positive number");
      }
    } else if (args[i] === "--skip-tests") {
      skipTests = true;
    }
  }

  return { pgVersions, shards, skipTests };
}

async function mergeAndReport(artifactPath: string): Promise<void> {
  const fixScript = join(repoRoot, "scripts", "fix-lcov-paths.ts");
  const mergeScript = join(repoRoot, "scripts", "merge-lcov.ts");
  const mergedPath = join(artifactPath, "merged-lcov.info");

  log("fix-lcov-paths");
  const fixResult = await run(["bun", fixScript, artifactPath], { cwd: repoRoot });
  console.log(fixResult.stdout);
  if (fixResult.stderr) console.error(fixResult.stderr);
  if (fixResult.exitCode !== 0) fail("fix-lcov-paths.ts failed");

  log("merge-lcov");
  const mergeResult = await run(
    ["bun", mergeScript, artifactPath, "-o", mergedPath],
    { cwd: repoRoot },
  );
  console.log(mergeResult.stdout);
  if (mergeResult.stderr) console.error(mergeResult.stderr);
  if (mergeResult.exitCode !== 0) fail("merge-lcov.ts failed");

  const hasGenhtml = await commandExists("genhtml");
  if (!hasGenhtml) fail("genhtml not installed. Install with: brew install lcov");
  const { stdout: versionOut } = await run(["genhtml", "--version"]);
  const versionMatch = versionOut.match(/LCOV version (\d+\.\d+)/);
  const localVersion = versionMatch?.[1] ?? "unknown";
  if (localVersion !== EXPECTED_LCOV_VERSION) {
    console.warn(
      `\n  WARNING: genhtml ${localVersion} differs from CI (${EXPECTED_LCOV_VERSION}). Install matching: brew install lcov\n`,
    );
  }

  log("genhtml");
  const htmlDir = join(artifactPath, "coverage-html");
  const genResult = await run([
    "genhtml",
    mergedPath,
    "--output-directory",
    htmlDir,
    "--rc",
    "branch_coverage=1",
    "--no-prefix",
  ]);
  if (genResult.exitCode !== 0) {
    console.error(genResult.stdout);
    console.error(genResult.stderr);
    fail("genhtml failed");
  }
  const summaryLines = genResult.stdout.trimEnd().split("\n").slice(-5).join("\n");
  console.log(summaryLines);

  const outDir = join(repoRoot, "coverage-html");
  await rm(outDir, { recursive: true, force: true });
  await cp(htmlDir, outDir, { recursive: true });

  log("RESULT");
  console.log("Coverage report: coverage-html/");
  console.log("  Open: open coverage-html/index.html");
  console.log("\nFinal coverage (from merge step above):");
  console.log(mergeResult.stdout.trim());
}

async function main(): Promise<void> {
  const { pgVersions, shards, skipTests } = parseArgs();
  log("Options");
  console.log(`  pg-versions: ${pgVersions.join(", ")}`);
  console.log(`  shards: ${shards}`);
  console.log(`  skip-tests: ${skipTests}`);
  console.log(`  artifact dir: ${artifactDir}`);

  if (skipTests) {
    if (!existsSync(join(artifactDir, "coverage-pg-delta-unit", "lcov.info"))) {
      fail(
        ".coverage-artifacts has no coverage-pg-delta-unit/lcov.info. Run without --skip-tests first to populate artifacts.",
      );
    }
    await mergeAndReport(artifactDir);
    return;
  }

  await rm(artifactDir, { recursive: true, force: true });
  await mkdir(artifactDir, { recursive: true });

  log("Step 1: pg-topo");
  const topoArtifact = join(artifactDir, "coverage-pg-topo");
  await mkdir(topoArtifact, { recursive: true });
  const topoResult = await run(
    ["bun", "run", "test"],
    { cwd: pgTopoRoot, env: { BUN_COVERAGE: "1" }, stdio: "inherit" },
  );
  if (topoResult.exitCode !== 0) fail("pg-topo tests failed");
  const topoLcov = join(pgTopoRoot, "coverage", "lcov.info");
  if (!existsSync(topoLcov)) fail("pg-topo did not produce coverage/lcov.info");
  await cp(topoLcov, join(topoArtifact, "lcov.info"));

  log("Step 2: pg-delta unit");
  const unitArtifact = join(artifactDir, "coverage-pg-delta-unit");
  await mkdir(unitArtifact, { recursive: true });
  const unitResult = await run(
    ["bun", "run", "test:unit"],
    { cwd: pgDeltaRoot, env: { BUN_COVERAGE: "1" }, stdio: "inherit" },
  );
  if (unitResult.exitCode !== 0) fail("pg-delta unit tests failed");
  const unitLcov = join(pgDeltaRoot, "coverage", "lcov.info");
  if (!existsSync(unitLcov)) fail("pg-delta unit did not produce coverage/lcov.info");
  await cp(unitLcov, join(unitArtifact, "lcov.info"));

  log("Step 3: pg-delta integration shards");
  const allTestFiles = await listPgDeltaTestFiles();
  console.log(`  Total test files: ${allTestFiles.length}`);
  const failedShards: string[] = [];
  for (const pgVer of pgVersions) {
    for (let shardIndex = 1; shardIndex <= shards; shardIndex++) {
      const index0 = shardIndex - 1;
      const shardFiles = allTestFiles.filter((_, i) => i % shards === index0);
      const name = `coverage-integration-pg${pgVer}-shard-${shardIndex}`;
      const dir = join(artifactDir, name);
      await mkdir(dir, { recursive: true });
      if (shardFiles.length === 0) {
        await writeFile(join(dir, "lcov.info"), "TN:\nend_of_record\n", "utf-8");
        continue;
      }
      console.log(`  ${name}: ${shardFiles.length} files`);
      const shardResult = await run(
        ["bun", "run", "test", ...shardFiles],
        {
          cwd: pgDeltaRoot,
          env: {
            BUN_COVERAGE: "1",
            PGDELTA_TEST_POSTGRES_VERSIONS: String(pgVer),
          },
          stdio: "inherit",
        },
      );
      const shardLcov = join(pgDeltaRoot, "coverage", "lcov.info");
      if (existsSync(shardLcov)) await cp(shardLcov, join(dir, "lcov.info"));
      if (shardResult.exitCode !== 0) failedShards.push(name);
    }
  }
  if (failedShards.length > 0) {
    console.warn(`\n  WARNING: ${failedShards.length} shard(s) failed: ${failedShards.join(", ")}`);
  }

  await mergeAndReport(artifactDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
