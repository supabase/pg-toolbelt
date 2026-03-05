/**
 * Fixes Bun's lcov output where SF: paths are missing the packages/{pkg}/
 * segment, strips records that should be excluded from coverage, and
 * removes DA (line data) entries for non-executable lines (blanks, comments)
 * so coverage percentage reflects only executable code.
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
 * Returns the set of 1-based line numbers that are executable (not blank,
 * not comment-only). Used to drop DA entries for comments/blanks so they
 * are not counted as uncovered.
 */
export function getExecutableLineNumbers(source: string): Set<number> {
  const lines = source.split(/\r?\n/);
  const executable = new Set<number>();
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed === "") continue;
    if (trimmed.startsWith("//")) continue;
    if (trimmed.startsWith("/*")) {
      if (!trimmed.includes("*/")) inBlockComment = true;
      continue;
    }

    executable.add(lineNum);
  }

  return executable;
}

/**
 * Removes DA:line,count lines for line numbers that are non-executable
 * (blank or comment) in the source file, so coverage only counts executable lines.
 * Requires repoRoot so SF paths (packages/pkg/...) can be resolved to disk.
 */
export async function stripNonExecutableDaLines(
  content: string,
  repoRoot: string,
  _pkg: string,
): Promise<{ content: string; removed: number }> {
  const lines = content.split("\n");
  const out: string[] = [];
  let removed = 0;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith("SF:")) {
      out.push(line);
      i++;
      continue;
    }

    const sfPath = line.slice(3);
    const absPath = join(repoRoot, sfPath);
    out.push(line);
    i++;

    let executable: Set<number> | null = null;
    if (existsSync(absPath)) {
      try {
        const source = await readFile(absPath, "utf-8");
        executable = getExecutableLineNumbers(source);
      } catch {
        // keep all DA lines if we can't read the file
      }
    }

    while (i < lines.length && lines[i] !== "end_of_record") {
      const l = lines[i];
      if (l.startsWith("DA:")) {
        const rest = l.slice(3);
        const comma = rest.indexOf(",");
        if (comma !== -1) {
          const lineNum = Number.parseInt(rest.slice(0, comma), 10);
          if (!Number.isNaN(lineNum) && executable && !executable.has(lineNum)) {
            removed++;
            i++;
            continue;
          }
        }
      }
      out.push(l);
      i++;
    }
    if (i < lines.length && lines[i] === "end_of_record") {
      out.push(lines[i]);
      i++;
    }
  }

  return { content: out.join("\n"), removed };
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
 * Rewrites SF: lines in lcov content so every path is a relative path
 * starting with packages/{pkg}/. Handles absolute paths (CI), relative
 * paths missing the prefix (local), and already-correct paths.
 * Pure string operation -- no filesystem checks.
 *
 * All output paths are relative: packages/{pkg}/src/...
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

    if (sfPath.startsWith(pkgSegment)) {
      return line;
    }

    if (sfPath.includes(`/${pkgSegment}`)) {
      const idx = sfPath.indexOf(`/${pkgSegment}`);
      fixed++;
      return `SF:${sfPath.slice(idx + 1)}`;
    }

    if (sfPath.startsWith(absPrefix)) {
      const relativePath = sfPath.slice(absPrefix.length);
      fixed++;
      return `SF:${pkgSegment}${relativePath}`;
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
  const repoRoot = dir.endsWith(".coverage-artifacts") ? resolve(dir, "..") : dir;
  const entries = await readdir(dir, { withFileTypes: true });
  let totalFixed = 0;
  let totalPaths = 0;
  let fileCount = 0;
  let totalStripped = 0;
  let totalDaRemoved = 0;

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
    const { content: pathFixed, fixed, total } = fixLcovContent(cleaned, dir, pkg);
    const { content, removed: daRemoved } = await stripNonExecutableDaLines(
      pathFixed,
      repoRoot,
      pkg,
    );
    fileCount++;
    totalFixed += fixed;
    totalPaths += total;
    totalStripped += stripped;
    totalDaRemoved += daRemoved;

    if (fixed > 0 || stripped > 0 || daRemoved > 0) {
      await writeFile(lcovPath, content);
      const parts: string[] = [];
      if (fixed > 0) parts.push(`fixed ${fixed}/${total} source paths`);
      if (stripped > 0)
        parts.push(`stripped ${stripped}/${recordTotal} records`);
      if (daRemoved > 0) parts.push(`removed ${daRemoved} non-executable DA lines`);
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
    if (totalDaRemoved > 0) parts.push(`removed ${totalDaRemoved} non-executable DA lines`);
    console.log(`Done: ${parts.join(", ")} across ${fileCount} files`);
  }
}
