/**
 * Test runner that resolves global-setup and test paths from this script's
 * location, so `bun run test` works correctly whether invoked from the
 * package directory or from the monorepo root (e.g. via `bun run --filter '*' test`).
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(import.meta.dir, "..");
const globalSetup = join(pkgRoot, "tests", "global-setup.ts");
const args = process.argv.slice(2);

const coveragePreload = fileURLToPath(
  import.meta.resolve("@supabase/bun-istanbul-coverage/preload"),
);
const coverageArgs =
  process.env.BUN_COVERAGE === "1" ? ["--preload", coveragePreload] : [];

const proc = Bun.spawn({
  cmd: [
    "bun",
    "test",
    ...coverageArgs,
    "--preload",
    globalSetup,
    "--concurrent",
    "--timeout",
    "15000",
    "--max-concurrency",
    "3",
    "--retry=3",
    ...args,
  ],
  cwd: pkgRoot,
  stdio: ["inherit", "inherit", "inherit"],
  env: {
    // Limit the number of pool connections to 1 to avoid overwhelming the alpine containers
    // on local dev
    PGDELTA_POOL_MAX: "1",
    PGDELTA_CONNECTION_TIMEOUT_MS: "2000",
    PGDELTA_CONNECT_TIMEOUT_MS: "2000",
    ...process.env,
  },
});

const exitCode = await proc.exited;
process.exit(exitCode);
