/**
 * Local coverage report generator that mirrors what CI does.
 *
 * Collects existing coverage/lcov.info from each package, runs
 * fix-lcov-paths.ts to normalize paths and strip exclusions,
 * concatenates the results, and generates an HTML report with genhtml.
 *
 * Usage: bun scripts/test-coverage-pipeline.ts
 *
 * Prerequisites:
 *   - Run tests with coverage first for each package you want included:
 *       cd packages/pg-delta && bun test --coverage --coverage-reporter=lcov src/
 *       cd packages/pg-topo && BUN_COVERAGE=1 bun run test
 *   - genhtml must be installed (brew install lcov)
 */
import { existsSync } from "node:fs";
import {
  cp,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const EXPECTED_LCOV_VERSION = "2.4";

const repoRoot = resolve(import.meta.dir, "..");
const scriptPath = join(repoRoot, "scripts", "fix-lcov-paths.ts");

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
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? repoRoot,
    env: { ...process.env, ...opts.env },
    stdout: "pipe",
    stderr: "pipe",
  });
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

async function findLcovFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findLcovFiles(full)));
    } else if (entry.name === "lcov.info") {
      results.push(full);
    }
  }
  return results;
}

const PACKAGES = [
  { name: "pg-delta", artifactDir: "coverage-pg-delta-unit" },
  { name: "pg-topo", artifactDir: "coverage-pg-topo" },
] as const;

// Step 1: Check for existing coverage data
log("Step 1: Checking for existing coverage data");
const available: { name: string; artifactDir: string; lcovPath: string }[] = [];
for (const pkg of PACKAGES) {
  const lcovPath = join(
    repoRoot,
    "packages",
    pkg.name,
    "coverage",
    "lcov.info",
  );
  if (existsSync(lcovPath)) {
    available.push({ ...pkg, lcovPath });
    console.log(`  ${pkg.name}: found`);
  } else {
    console.warn(`  ${pkg.name}: NOT FOUND (run tests with coverage first)`);
  }
}
if (available.length === 0) {
  fail(
    "No coverage data found. Run tests first:\n" +
      "  cd packages/pg-delta && bun test --coverage --coverage-reporter=lcov src/\n" +
      "  cd packages/pg-topo && BUN_COVERAGE=1 bun run test",
  );
}

// Step 2: Create temp dir simulating CI artifact layout
log("Step 2: Simulating CI artifact directory layout");
const tempDir = await mkdtemp(join(tmpdir(), "coverage-pipeline-"));
console.log(`Temp dir: ${tempDir}`);

try {
  for (const pkg of available) {
    const artifactDir = join(tempDir, pkg.artifactDir);
    await Bun.write(join(artifactDir, "lcov.info"), "");
    await cp(pkg.lcovPath, join(artifactDir, "lcov.info"));
    console.log(`  Created ${pkg.artifactDir}/lcov.info`);
  }

  // Step 3: Run fix-lcov-paths.ts
  log("Step 3: Running fix-lcov-paths.ts");
  {
    const { exitCode, stdout, stderr } = await run(
      ["bun", scriptPath, tempDir],
      { cwd: repoRoot },
    );
    console.log(stdout);
    if (stderr) console.error(stderr);
    if (exitCode !== 0) {
      fail("fix-lcov-paths.ts exited with non-zero");
    }
  }

  // Step 4: Verify the fix across all artifacts
  log("Step 4: Verifying fixed lcov paths");
  const allLcovFiles = await findLcovFiles(tempDir);
  const allSfLines: string[] = [];
  for (const lcovFile of allLcovFiles) {
    const content = await readFile(lcovFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.startsWith("SF:"));
    allSfLines.push(...lines);
  }

  const totalSF = allSfLines.length;
  const withDeltaPrefix = allSfLines.filter((l) =>
    l.includes("packages/pg-delta/"),
  );
  const withTopoPrefix = allSfLines.filter((l) =>
    l.includes("packages/pg-topo/"),
  );
  const crossPkgLeaks = allSfLines.filter((l) => l.includes("../"));
  const testFiles = allSfLines.filter((l) => l.endsWith(".test.ts"));
  const testInfra = allSfLines.filter(
    (l) => l.includes("/test/") || l.includes("/tests/"),
  );

  console.log(`Total SF: lines: ${totalSF}`);
  console.log(`  packages/pg-delta/: ${withDeltaPrefix.length}`);
  console.log(`  packages/pg-topo/: ${withTopoPrefix.length}`);
  console.log(`Cross-package leaks: ${crossPkgLeaks.length}`);
  console.log(`Test files (*.test.ts): ${testFiles.length}`);
  console.log(`Test infrastructure: ${testInfra.length}`);

  if (crossPkgLeaks.length > 0) {
    for (const l of crossPkgLeaks) console.error(`  leak: ${l}`);
    fail("Cross-package leak(s) not stripped");
  }
  if (testFiles.length > 0) {
    for (const l of testFiles.slice(0, 5)) console.error(`  test: ${l}`);
    fail("Test file(s) not stripped");
  }
  if (testInfra.length > 0) {
    for (const l of testInfra.slice(0, 5)) console.error(`  infra: ${l}`);
    fail("Test infrastructure file(s) not stripped");
  }

  // Step 5: Concatenate all fixed lcov files (genhtml handles dedup)
  log("Step 5: Merging coverage files");
  const mergedPath = join(tempDir, "merged-lcov.info");
  const allContents = await Promise.all(
    allLcovFiles.map((f) => readFile(f, "utf-8")),
  );
  await writeFile(mergedPath, allContents.join("\n"));
  console.log(`Concatenated ${allLcovFiles.length} lcov files`);

  // Step 6: genhtml
  const hasGenhtml = await commandExists("genhtml");
  if (!hasGenhtml) {
    fail("genhtml not installed. Install with: brew install lcov");
  }

  {
    const { stdout } = await run(["genhtml", "--version"]);
    const versionMatch = stdout.match(/LCOV version (\d+\.\d+)/);
    const localVersion = versionMatch?.[1] ?? "unknown";
    if (localVersion !== EXPECTED_LCOV_VERSION) {
      console.warn(
        `\n  WARNING: local genhtml version ${localVersion} differs from CI (${EXPECTED_LCOV_VERSION}).` +
          "\n  Coverage output may differ. Install matching version: brew install lcov\n",
      );
    }
  }

  log("Step 6: Generating HTML report with genhtml");
  const htmlDir = join(tempDir, "coverage-html");
  const result = await run([
    "genhtml",
    mergedPath,
    "--output-directory",
    htmlDir,
    "--rc",
    "branch_coverage=1",
    "--no-prefix",
  ]);
  if (result.exitCode !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    fail("genhtml failed");
  }
  console.log(result.stdout);

  const outDir = join(repoRoot, "coverage-html");
  await rm(outDir, { recursive: true, force: true });
  await cp(htmlDir, outDir, { recursive: true });

  // Extract what CI puts into GITHUB_STEP_SUMMARY
  const summaryLines = result.stdout.trimEnd().split("\n").slice(-5).join("\n");
  log("GITHUB_STEP_SUMMARY preview");
  console.log("## Coverage Summary");
  console.log(summaryLines);

  log("RESULT");
  console.log("Coverage report generated successfully");
  console.log(`  pg-delta: ${withDeltaPrefix.length} source files`);
  console.log(`  pg-topo: ${withTopoPrefix.length} source files`);
  console.log(`  Total: ${totalSF} source files`);
  console.log("\nHTML report saved to coverage-html/");
  console.log("  Open with: open coverage-html/index.html");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
