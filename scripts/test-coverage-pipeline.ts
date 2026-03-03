/**
 * End-to-end validation of the coverage pipeline.
 *
 * Reproduces what CI does: runs real tests with --coverage, simulates the
 * artifact directory layout, runs fix-lcov-paths.ts, merges with lcov, and
 * runs genhtml. Validates that the full pipeline works with actual coverage
 * data.
 *
 * Usage: bun scripts/test-coverage-pipeline.ts
 *
 * Prerequisites:
 *   - bun install (dependencies must be installed)
 *   - lcov + genhtml for full validation (skipped gracefully if missing)
 */
import { existsSync } from "node:fs";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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

// Step 1: Run pg-delta unit tests with coverage (fast, no Docker)
log("Step 1: Running pg-delta unit tests with coverage");
const pgDeltaCoverageDir = join(repoRoot, "packages", "pg-delta", "coverage");
{
	const { exitCode, stderr } = await run(
		[
			"bun",
			"test",
			"--coverage",
			"--coverage-reporter=lcov",
			"--concurrent",
			"--timeout",
			"15000",
			"src/",
		],
		{ cwd: join(repoRoot, "packages", "pg-delta") },
	);
	if (exitCode !== 0) {
		console.error(stderr);
		fail("pg-delta unit tests failed");
	}
	const lcovPath = join(pgDeltaCoverageDir, "lcov.info");
	if (!existsSync(lcovPath)) {
		fail(`Expected ${lcovPath} to exist after test run`);
	}
	console.log("pg-delta unit tests passed, lcov.info generated");
}

// Step 2: Create temp dir simulating CI artifact layout
log("Step 2: Simulating CI artifact directory layout");
const tempDir = await mkdtemp(join(tmpdir(), "coverage-pipeline-"));
console.log(`Temp dir: ${tempDir}`);

try {
	const artifactDir = join(tempDir, "coverage-pg-delta-unit");
	await Bun.write(join(artifactDir, "lcov.info"), "");
	await cp(
		join(pgDeltaCoverageDir, "lcov.info"),
		join(artifactDir, "lcov.info"),
	);
	console.log("Created coverage-pg-delta-unit/lcov.info");

	// Show a sample of the raw SF: lines before fixing
	const rawContent = await readFile(join(artifactDir, "lcov.info"), "utf-8");
	const sampleSF = rawContent
		.split("\n")
		.filter((l) => l.startsWith("SF:"))
		.slice(0, 3);
	console.log("Sample SF: lines before fix:");
	for (const line of sampleSF) console.log(`  ${line}`);

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
			fail(`fix-lcov-paths.ts exited with code ${exitCode}`);
		}
	}

	// Step 4: Verify the fix
	log("Step 4: Verifying fixed lcov paths");
	const fixedContent = await readFile(
		join(artifactDir, "lcov.info"),
		"utf-8",
	);
	const sfLines = fixedContent
		.split("\n")
		.filter((l) => l.startsWith("SF:"));
	const totalSF = sfLines.length;
	const withPackagePrefix = sfLines.filter((l) =>
		l.includes("packages/pg-delta/"),
	);
	const existingOnDisk = sfLines.filter((l) => existsSync(l.slice(3)));

	console.log(`Total SF: lines: ${totalSF}`);
	console.log(
		`With packages/pg-delta/ prefix: ${withPackagePrefix.length}/${totalSF}`,
	);
	console.log(`Resolve to real files on disk: ${existingOnDisk.length}/${totalSF}`);

	console.log("\nSample SF: lines after fix:");
	for (const line of sfLines.slice(0, 3)) console.log(`  ${line}`);

	if (withPackagePrefix.length === 0) {
		fail(
			"No SF: lines were rewritten -- fix-lcov-paths.ts did not work",
		);
	}
	if (existingOnDisk.length === 0) {
		fail("No fixed SF: paths resolve to actual files on disk");
	}
	if (existingOnDisk.length < totalSF) {
		const missing = sfLines.filter((l) => !existsSync(l.slice(3)));
		console.warn(
			`\nWARN: ${missing.length} paths don't resolve to files:`,
		);
		for (const m of missing.slice(0, 5))
			console.warn(`  ${m.slice(3)}`);
	}

	// Step 5: lcov merge (if available)
	const hasLcov = await commandExists("lcov");
	if (hasLcov) {
		log("Step 5: Merging coverage with lcov");
		const mergedPath = join(tempDir, "merged-lcov.info");
		const { exitCode, stderr } = await run([
			"lcov",
			"--add-tracefile",
			join(artifactDir, "lcov.info"),
			"--output-file",
			mergedPath,
			"--rc",
			"branch_coverage=1",
		]);
		if (exitCode !== 0) {
			console.error(stderr);
			fail("lcov merge failed");
		}
		console.log("lcov merge succeeded");

		// Step 6: genhtml (if available)
		const hasGenhtml = await commandExists("genhtml");
		if (hasGenhtml) {
			log("Step 6: Generating HTML report with genhtml");
			const htmlDir = join(tempDir, "coverage-html");
			const result = await run([
				"genhtml",
				mergedPath,
				"--output-directory",
				htmlDir,
				"--rc",
				"branch_coverage=1",
			]);
			if (result.exitCode !== 0) {
				console.error(result.stderr);
				fail("genhtml failed");
			}
			console.log("genhtml succeeded");
			console.log(
				`HTML report: ${htmlDir}/index.html`,
			);
		} else {
			log("Step 6: SKIPPED (genhtml not installed)");
			console.log("Install lcov to run this step: brew install lcov");
		}
	} else {
		log("Step 5-6: SKIPPED (lcov not installed)");
		console.log("Install lcov to run these steps: brew install lcov");
	}

	log("RESULT");
	console.log("Coverage pipeline validation PASSED");
	console.log(
		`  ${withPackagePrefix.length}/${totalSF} SF: paths rewritten`,
	);
	console.log(
		`  ${existingOnDisk.length}/${totalSF} paths resolve to files on disk`,
	);
	if (hasLcov) console.log("  lcov merge: OK");
	if (hasLcov && (await commandExists("genhtml")))
		console.log("  genhtml: OK");
} finally {
	await rm(tempDir, { recursive: true, force: true });
}
