/**
 * Test runner that resolves global-setup and test paths from this script's
 * location, so `bun run test` works correctly whether invoked from the
 * package directory or from the monorepo root (e.g. via `bun run --filter '*' test`).
 */
import { join } from "node:path";

const pkgRoot = join(import.meta.dir, "..");
const globalSetup = join(pkgRoot, "test", "global-setup.ts");
const args = process.argv.slice(2);

const proc = Bun.spawn({
  cmd: [
    "bun",
    "test",
    "--preload",
    globalSetup,
    "--timeout",
    "15000",
    "--concurrent",
    "--max-concurrency",
    "8",
    ...args,
  ],
  cwd: pkgRoot,
  stdio: ["inherit", "inherit", "inherit"],
});

const exitCode = await proc.exited;
process.exit(exitCode);
