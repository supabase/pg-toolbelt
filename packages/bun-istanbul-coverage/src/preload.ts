/**
 * Zero-config preload entry point. Walks up from the current working
 * directory to find `.nycrc.json` and calls `setupCoverage()` with the
 * derived options. Glob patterns are anchored to the directory where the
 * config file was found (typically the repo root).
 *
 * Usage:
 *   bun test --preload @supabase/bun-istanbul-coverage/preload
 */
import { join } from "node:path";
import { globToRegex, readNycConfig } from "./config.js";
import { setupCoverage } from "./index.js";

const cwd = process.cwd();
const result = readNycConfig(cwd);
const config = result?.config;
const rootDir = result?.configDir ?? cwd;

const include = config?.include?.map((g) => globToRegex(g, rootDir));
const exclude = config?.exclude?.map((g) => globToRegex(g, rootDir));

setupCoverage({
  include: include?.length ? include : undefined,
  exclude: exclude?.length ? exclude : undefined,
  outputDir: process.env.NYC_OUTPUT_DIR
    ? undefined
    : config?.["temp-dir"]
      ? join(rootDir, config["temp-dir"])
      : undefined,
});
