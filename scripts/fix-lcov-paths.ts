/**
 * Fixes Bun's lcov output where SF: paths are missing the packages/{pkg}/
 * segment. Determines the target package from the artifact directory name
 * (deterministic, no filesystem guessing) and rewrites SF: lines accordingly.
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

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkg = packageForArtifact(entry.name);
    if (!pkg) continue;

    const lcovPath = join(dir, entry.name, "lcov.info");
    if (!existsSync(lcovPath)) continue;

    const raw = await readFile(lcovPath, "utf-8");
    const { content, fixed, total } = fixLcovContent(raw, dir, pkg);
    fileCount++;
    totalFixed += fixed;
    totalPaths += total;

    if (fixed > 0) {
      await writeFile(lcovPath, content);
      console.log(
        `${basename(entry.name)}/lcov.info: fixed ${fixed}/${total} source paths (-> packages/${pkg}/)`,
      );
    }
  }

  if (fileCount === 0) {
    console.log("No lcov.info files found in coverage-* directories");
  } else {
    console.log(
      `Done: fixed ${totalFixed}/${totalPaths} source paths across ${fileCount} files`,
    );
  }
}
