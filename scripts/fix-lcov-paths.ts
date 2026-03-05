/**
 * Fixes Bun's lcov output where SF: paths are missing the packages/{pkg}/
 * segment, and strips records that should be excluded from coverage
 * (cross-package leaks, test files, infrastructure files).
 *
 * Bun ignores [test] settings in bunfig.toml (oven-sh/bun#17664), so
 * coverageSkipTestFiles and coveragePathIgnorePatterns don't take effect.
 * This script replicates those exclusions at the lcov post-processing stage.
 *
 * Usage: bun scripts/fix-lcov-paths.ts [directory]
 *
 * The directory (defaults to ".") should contain coverage-* artifact
 * directories, each with an lcov.info file inside.
 */
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

/**
 * Maps a CI artifact directory name to the monorepo package it belongs to.
 * Returns null for non-package artifacts (e.g. coverage-merged, coverage-html).
 */
export function packageForArtifact(dirName: string): string | null {
  if (
    dirName.startsWith("coverage-pg-delta-") ||
    dirName.startsWith("coverage-integration-")
  ) {
    return "pg-delta";
  }
  if (dirName.startsWith("coverage-pg-topo")) {
    return "pg-topo";
  }
  return null;
}

/**
 * Per-package coverage ignore configuration.
 * Mirrors bunfig.toml [test] settings that Bun ignores (oven-sh/bun#17664).
 */
export const COVERAGE_IGNORE: Record<
  string,
  { skipTestFiles: boolean; patterns: string[] }
> = {
  "pg-delta": {
    skipTestFiles: true,
    patterns: [
      "tests/constants.ts",
      "tests/container-manager.ts",
      "tests/global-setup.ts",
      "tests/integration/roundtrip.ts",
      "tests/postgres-alpine.ts",
      "tests/postgres-ssl.ts",
      "tests/ssl-utils.ts",
      "tests/supabase-postgres.ts",
      "tests/utils.ts",
      "**/changes/*.base.ts",
      "src/core/sort/debug-visualization.ts",
    ],
  },
  "pg-topo": {
    skipTestFiles: true,
    patterns: ["test/global-setup.ts", "test/support/**"],
  },
};

/**
 * Converts a simple glob pattern to a RegExp.
 * Supports **‍/ (zero or more directory segments) and * (anything except /).
 */
export function globToRegex(pattern: string): RegExp {
  let p = pattern;
  let suffix = "";
  if (p.endsWith("/**")) {
    p = p.slice(0, -3);
    suffix = "/.*";
  }

  const parts = p.split("**/");
  const escaped = parts.map((part) => {
    return part
      .split("*")
      .map((literal) => escapeForRegex(literal))
      .join("[^/]*");
  });
  const joined = escaped.join("(.*/)?");
  return new RegExp(`^${joined}${suffix}$`);
}

function escapeForRegex(s: string): string {
  return s.replace(/[.+?^$|()\\]/g, "\\$&");
}

/**
 * Returns true if an SF: path should be stripped from coverage for the
 * given package. Checks cross-package leaks, test files, and per-package
 * ignore patterns.
 */
export function shouldStripPath(sfPath: string, pkg: string): boolean {
  if (sfPath.startsWith("../")) return true;

  const config = COVERAGE_IGNORE[pkg];
  if (!config) return false;

  if (config.skipTestFiles && sfPath.endsWith(".test.ts")) return true;

  for (const pattern of config.patterns) {
    if (globToRegex(pattern).test(sfPath)) return true;
  }

  return false;
}

/**
 * Strips entire lcov records (SF: through end_of_record) for paths that
 * should be excluded from coverage. Must be called BEFORE fixLcovContent
 * so we never try to rewrite paths that will be removed.
 */
export function stripLcovRecords(
  content: string,
  pkg: string,
): { content: string; stripped: number; total: number } {
  const lines = content.split("\n");
  const outputLines: string[] = [];
  let recordLines: string[] = [];
  let recordSfPath: string | null = null;
  let stripped = 0;
  let total = 0;

  for (const line of lines) {
    if (line.startsWith("SF:")) {
      recordLines = [line];
      recordSfPath = line.slice(3);
      total++;
    } else if (line === "end_of_record") {
      recordLines.push(line);
      if (recordSfPath && shouldStripPath(recordSfPath, pkg)) {
        stripped++;
      } else {
        outputLines.push(...recordLines);
      }
      recordLines = [];
      recordSfPath = null;
    } else if (recordLines.length > 0) {
      recordLines.push(line);
    } else {
      outputLines.push(line);
    }
  }

  if (recordLines.length > 0) {
    if (recordSfPath && shouldStripPath(recordSfPath, pkg)) {
      stripped++;
    } else {
      outputLines.push(...recordLines);
    }
  }

  return { content: outputLines.join("\n"), stripped, total };
}

/**
 * Rewrites SF: lines in lcov content to insert packages/{pkg}/.
 * Handles both absolute paths (CI) and relative paths (local).
 * Pure string operation -- no filesystem checks.
 *
 * Idempotent: paths already containing packages/{pkg}/ are left unchanged.
 */
export function fixLcovContent(
  content: string,
  repoRoot: string,
  pkg: string,
): { content: string; fixed: number; total: number } {
  const absPrefix = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`;
  const pkgSegment = `packages/${pkg}/`;
  const lines = content.split("\n");
  let fixed = 0;
  let total = 0;

  const newLines = lines.map((line) => {
    if (!line.startsWith("SF:")) return line;
    total++;
    const sfPath = line.slice(3);

    if (sfPath.includes(`/${pkgSegment}`) || sfPath.startsWith(pkgSegment)) {
      return line;
    }

    if (sfPath.startsWith(absPrefix)) {
      const relativePath = sfPath.slice(absPrefix.length);
      fixed++;
      return `SF:${absPrefix}${pkgSegment}${relativePath}`;
    }

    if (!sfPath.startsWith("/")) {
      fixed++;
      return `SF:${pkgSegment}${sfPath}`;
    }

    return line;
  });

  return { content: newLines.join("\n"), fixed, total };
}

if (import.meta.main) {
  const dir = resolve(process.argv[2] || ".");
  const entries = await readdir(dir, { withFileTypes: true });
  let totalFixed = 0;
  let totalPaths = 0;
  let fileCount = 0;

  let totalStripped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkg = packageForArtifact(entry.name);
    if (!pkg) continue;

    const lcovPath = join(dir, entry.name, "lcov.info");
    if (!existsSync(lcovPath)) continue;

    const raw = await readFile(lcovPath, "utf-8");
    const {
      content: cleaned,
      stripped,
      total: recordTotal,
    } = stripLcovRecords(raw, pkg);
    const { content, fixed, total } = fixLcovContent(cleaned, dir, pkg);
    fileCount++;
    totalFixed += fixed;
    totalPaths += total;
    totalStripped += stripped;

    if (fixed > 0 || stripped > 0) {
      await writeFile(lcovPath, content);
      const parts: string[] = [];
      if (fixed > 0) parts.push(`fixed ${fixed}/${total} source paths`);
      if (stripped > 0)
        parts.push(`stripped ${stripped}/${recordTotal} records`);
      console.log(
        `${basename(entry.name)}/lcov.info: ${parts.join(", ")} (-> packages/${pkg}/)`,
      );
    }
  }

  if (fileCount === 0) {
    console.log("No lcov.info files found in coverage-* directories");
  } else {
    const parts = [
      `fixed ${totalFixed}/${totalPaths} source paths`,
      `stripped ${totalStripped} records`,
    ];
    console.log(`Done: ${parts.join(", ")} across ${fileCount} files`);
  }
}
