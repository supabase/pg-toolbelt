import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface NycConfig {
  include?: string[];
  exclude?: string[];
  "temp-dir"?: string;
  "report-dir"?: string;
  reporter?: string[];
}

const NYC_CONFIG_FILES = [".nycrc.json", ".nycrc", ".nycrc.yml"] as const;

/**
 * Reads nyc configuration from the first config file found in `rootDir`.
 * Only JSON formats are supported (`.nycrc.json`, `.nycrc`).
 * Returns `null` if no config file exists.
 */
export function readNycConfig(rootDir: string): NycConfig | null {
  for (const filename of NYC_CONFIG_FILES) {
    const filepath = join(rootDir, filename);
    if (!existsSync(filepath)) continue;
    try {
      const raw = readFileSync(filepath, "utf-8");
      return JSON.parse(raw) as NycConfig;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Converts a nyc-style glob pattern into a RegExp that matches absolute paths.
 *
 * Supports:
 * - `**​/` -- zero or more directory segments
 * - `*` -- anything except `/`
 * - Literal characters are escaped
 *
 * The returned regex is anchored to `rootDir` so that a pattern like
 * `"src/**​/*.ts"` matches `/abs/path/to/project/src/foo/bar.ts`.
 */
export function globToRegex(pattern: string, rootDir: string): RegExp {
  const escapedRoot = escapeForRegex(
    rootDir.endsWith("/") ? rootDir : `${rootDir}/`,
  );

  let rest = pattern;
  let suffix = "";
  if (rest.endsWith("/**")) {
    rest = rest.slice(0, -3);
    suffix = "/.*";
  }

  const parts = rest.split("**/");
  const regexParts = parts.map((part) =>
    part
      .split("*")
      .map((literal) => escapeForRegex(literal))
      .join("[^/]*"),
  );
  const joined = regexParts.join("(.*/)?");

  return new RegExp(`^${escapedRoot}${joined}${suffix}$`);
}

function escapeForRegex(s: string): string {
  return s.replace(/[.+?^$|()\\{}[\]]/g, "\\$&");
}
