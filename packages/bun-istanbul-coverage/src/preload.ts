/**
 * Zero-config preload entry point. Reads `.nycrc.json` from the current
 * working directory and calls `setupCoverage()` with the derived options.
 *
 * Usage:
 *   bun test --preload @supabase/bun-istanbul-coverage/preload
 */
import { join } from "node:path";
import { globToRegex, readNycConfig } from "./config.ts";
import { setupCoverage } from "./index.ts";

const cwd = process.cwd();
const config = readNycConfig(cwd);

const include = config?.include?.map((g) => globToRegex(g, cwd));
const exclude = config?.exclude?.map((g) => globToRegex(g, cwd));

setupCoverage({
  include: include?.length ? include : undefined,
  exclude: exclude?.length ? exclude : undefined,
  outputDir: config?.["temp-dir"] ? join(cwd, config["temp-dir"]) : undefined,
});
