/**
 * Test runner that resolves global-setup and test paths from this script's
 * location, so `bun run test` works correctly whether invoked from the
 * package directory or from the monorepo root (e.g. via `bun run --filter '*' test`).
 */
import { join } from "node:path";

const pkgRoot = join(import.meta.dir, "..");
const globalSetup = join(pkgRoot, "tests", "global-setup.ts");
const args = process.argv.slice(2);

const coverageArgs =
  process.env.BUN_COVERAGE === "1"
    ? ["--coverage", "--coverage-reporter=lcov"]
    : [];

const proc = Bun.spawn({
  cmd: [
    "bun",
    "test",
    "--preload",
    globalSetup,
    "--concurrent",
    "--timeout",
    "30000",
    "--max-concurrency",
    "4",
    ...coverageArgs,
    ...args,
  ],
  cwd: pkgRoot,
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    ...process.env,
    // Limit the number of pool connections to 1 to avoid overwhelming the alpine containers
    PGDELTA_POOL_MAX: "1",
  },
});

const exitCode = await proc.exited;
process.exit(exitCode);
