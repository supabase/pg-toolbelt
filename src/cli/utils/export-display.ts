/**
 * CLI helpers for declarative export: file tree, diff, and summary formatting.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";
import type { FileEntry } from "../../core/export/types.ts";

// ============================================================================
// Types
// ============================================================================

export interface FileDiffResult {
  created: string[];
  updated: string[];
  deleted: string[];
  unchanged: string[];
}

// ============================================================================
// File tree
// ============================================================================

export interface BuildFileTreeOptions {
  /** When provided, leaf paths are prefixed with + / ~ / - and colorized (created / updated / deleted). */
  diff?: FileDiffResult;
  /** When true, only paths that are created, updated, or deleted are shown; unchanged are omitted. Includes diff.deleted in the tree. */
  diffFocus?: boolean;
}

type FileStatus = "created" | "updated" | "deleted" | "unchanged";

function getFileStatus(path: string, diff: FileDiffResult): FileStatus {
  if (diff.created.includes(path)) return "created";
  if (diff.updated.includes(path)) return "updated";
  if (diff.deleted.includes(path)) return "deleted";
  return "unchanged";
}

function formatLeafSegment(segment: string, status: FileStatus): string {
  switch (status) {
    case "created":
      return chalk.green("+ " + segment);
    case "updated":
      return chalk.yellow("~ " + segment);
    case "deleted":
      return chalk.red("- " + segment);
    default:
      return chalk.dim(segment);
  }
}

/**
 * Build a directory tree string from file paths.
 * Groups by directory, shows files as leaves with indentation.
 * When options.diff is provided, leaf names are prefixed with + (created), ~ (updated), - (deleted) and colorized.
 * When options.diffFocus is true, only changed paths (and their ancestors) are shown; unchanged files are omitted.
 *
 * @param files - Array of relative file paths (e.g. ["schemas/public/schema.sql", "schemas/public/tables/users.sql"])
 * @param outputDir - Display name for the root (e.g. "declarative-schemas")
 * @param options - Optional diff and diffFocus for symbols and filtering
 */
export function buildFileTree(
  files: string[],
  outputDir: string,
  options?: BuildFileTreeOptions,
): string {
  const { diff, diffFocus } = options ?? {};
  let pathsToShow = files;

  if (diffFocus && diff) {
    const changed = new Set<string>([
      ...diff.created,
      ...diff.updated,
      ...diff.deleted,
    ]);
    pathsToShow = [...changed];
    if (pathsToShow.length === 0) {
      return chalk.dim("(no file changes)");
    }
  }

  const tree = new Map<string, Set<string>>();

  for (const filePath of pathsToShow) {
    const segments = filePath.split("/");
    let parent = "";
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const fullPath = parent ? `${parent}/${segment}` : segment;
      let children = tree.get(parent);
      if (!children) {
        children = new Set();
        tree.set(parent, children);
      }
      children.add(fullPath);
      parent = fullPath;
    }
  }

  const lines: string[] = [];

  function emit(relPath: string, indent: number, isLast: boolean): void {
    const segment = relPath ? path.basename(relPath) : outputDir;
    const prefix =
      indent === 0 ? "" : "  ".repeat(indent) + (isLast ? "└── " : "├── ");
    const isLeaf = !tree.has(relPath);
    const displaySegment =
      diff && isLeaf
        ? formatLeafSegment(segment, getFileStatus(relPath, diff))
        : segment;
    lines.push(prefix + displaySegment);
    const children = tree.get(relPath);
    if (children) {
      const sorted = [...children].sort((a, b) =>
        path.basename(a).localeCompare(path.basename(b)),
      );
      for (let i = 0; i < sorted.length; i++) {
        emit(sorted[i], indent + 1, i === sorted.length - 1);
      }
    }
  }

  emit("", 0, false);
  return lines.join("\n");
}

// ============================================================================
// File diff
// ============================================================================

/**
 * Recursively collect relative paths of all files under a directory.
 */
async function collectExistingFiles(dir: string, base = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, base), { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isFile()) {
      files.push(rel);
    } else if (e.isDirectory()) {
      files.push(...(await collectExistingFiles(dir, rel)));
    }
  }
  return files;
}

/**
 * Compare existing output directory with new file set.
 * Returns created, updated, deleted, and unchanged paths.
 */
export async function computeFileDiff(
  outputDir: string,
  newFiles: FileEntry[],
): Promise<FileDiffResult> {
  const newPaths = new Set(newFiles.map((f) => f.path));
  const newByPath = new Map(newFiles.map((f) => [f.path, f]));

  let existingPaths: string[] = [];
  try {
    existingPaths = await collectExistingFiles(outputDir);
  } catch {
    // Directory doesn't exist or not readable
    return {
      created: [...newPaths],
      updated: [],
      deleted: [],
      unchanged: [],
    };
  }

  const existingSet = new Set(existingPaths);
  const created: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  for (const p of newPaths) {
    if (!existingSet.has(p)) {
      created.push(p);
    } else {
      const entry = newByPath.get(p);
      if (!entry) continue;
      try {
        const existingContent = await readFile(
          path.join(outputDir, p),
          "utf-8",
        );
        if (existingContent.trim() !== entry.sql.trim()) {
          updated.push(p);
        } else {
          unchanged.push(p);
        }
      } catch {
        updated.push(p);
      }
    }
  }

  for (const p of existingPaths) {
    if (!newPaths.has(p)) {
      deleted.push(p);
    }
  }

  return { created, updated, deleted, unchanged };
}

// ============================================================================
// Summary formatting
// ============================================================================

/**
 * Format the created/deleted/updated summary with colors.
 * In dry-run mode, uses "would create/delete/update" phrasing.
 */
export function formatExportSummary(
  diff: FileDiffResult,
  dryRun: boolean,
): string {
  const lines: string[] = [];
  const verb = dryRun ? "Would" : "";

  if (diff.created.length > 0) {
    lines.push(
      chalk.green(
        `${verb ? `${verb} create` : "Created"}: ${diff.created.length} file(s)`,
      ),
    );
  }
  if (diff.updated.length > 0) {
    lines.push(
      chalk.yellow(
        `${verb ? `${verb} update` : "Updated"}: ${diff.updated.length} file(s)`,
      ),
    );
  }
  if (diff.deleted.length > 0) {
    lines.push(
      chalk.red(
        `${verb ? `${verb} delete` : "Deleted"}: ${diff.deleted.length} file(s)`,
      ),
    );
  }
  if (diff.unchanged.length > 0 && !dryRun) {
    lines.push(chalk.dim(`Unchanged: ${diff.unchanged.length} file(s)`));
  }

  return lines.length > 0 ? lines.join("\n") : "";
}
