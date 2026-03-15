/**
 * CLI helpers for declarative export: file tree, diff, and summary formatting.
 */

import path from "node:path";
import chalk from "chalk";
import { Effect, FileSystem } from "effect";
import type { FileEntry } from "../../core/export/types.ts";

/**
 * Ensure a relative file path does not escape the output directory.
 * Uses Node.js path.resolve + startsWith as the canonical traversal check.
 */
export function assertSafePath(filePath: string, outputDir: string): void {
  const resolvedOutput = path.resolve(outputDir);
  const resolvedFile = path.resolve(outputDir, filePath);
  if (
    resolvedFile !== resolvedOutput &&
    !resolvedFile.startsWith(resolvedOutput + path.sep)
  ) {
    throw new Error(
      `Export path traversal detected: '${filePath}' resolves outside output directory`,
    );
  }
}

interface FileDiffResult {
  created: string[];
  updated: string[];
  deleted: string[];
  unchanged: string[];
}

interface BuildFileTreeOptions {
  diff?: FileDiffResult;
  diffFocus?: boolean;
  useColors?: boolean;
}

type FileStatus = "created" | "updated" | "deleted" | "unchanged";

function getFileStatus(path: string, diff: FileDiffResult): FileStatus {
  if (diff.created.includes(path)) return "created";
  if (diff.updated.includes(path)) return "updated";
  if (diff.deleted.includes(path)) return "deleted";
  return "unchanged";
}

function formatLeafSegment(
  segment: string,
  status: FileStatus,
  useColors = true,
): string {
  if (!useColors) {
    switch (status) {
      case "created":
        return `+ ${segment}`;
      case "updated":
        return `~ ${segment}`;
      case "deleted":
        return `- ${segment}`;
      default:
        return segment;
    }
  }
  switch (status) {
    case "created":
      return chalk.green(`+ ${segment}`);
    case "updated":
      return chalk.yellow(`~ ${segment}`);
    case "deleted":
      return chalk.red(`- ${segment}`);
    default:
      return chalk.dim(segment);
  }
}

export function buildFileTree(
  files: string[],
  outputDir: string,
  options?: BuildFileTreeOptions,
): string {
  const { diff, diffFocus, useColors = true } = options ?? {};
  let pathsToShow = files;

  if (diffFocus && diff) {
    const changed = new Set<string>([
      ...diff.created,
      ...diff.updated,
      ...diff.deleted,
    ]);
    pathsToShow = [...changed];
    if (pathsToShow.length === 0) {
      return useColors ? chalk.dim("(no file changes)") : "(no file changes)";
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
        ? formatLeafSegment(segment, getFileStatus(relPath, diff), useColors)
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

const collectExistingFiles = (
  dir: string,
  base = "",
): Effect.Effect<string[], never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs
      .readDirectory(path.join(dir, base))
      .pipe(Effect.orElseSucceed(() => []));
    const files: string[] = [];
    for (const entry of entries) {
      const rel = base ? `${base}/${entry}` : entry;
      const fullPath = path.join(dir, rel);
      const info = yield* fs
        .stat(fullPath)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (info?.type === "File" && entry.endsWith(".sql")) {
        files.push(rel);
      } else if (info?.type === "Directory") {
        files.push(...(yield* collectExistingFiles(dir, rel)));
      }
    }
    return files;
  });

export const computeFileDiff = (
  outputDir: string,
  newFiles: FileEntry[],
): Effect.Effect<FileDiffResult, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const newPaths = new Set(newFiles.map((file) => file.path));
    const newByPath = new Map(newFiles.map((file) => [file.path, file]));

    const existingPaths = yield* collectExistingFiles(outputDir);
    if (existingPaths.length === 0) {
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

    for (const filePath of newPaths) {
      if (!existingSet.has(filePath)) {
        created.push(filePath);
        continue;
      }

      const entry = newByPath.get(filePath);
      if (!entry) continue;

      const existingContent = yield* fs
        .readFileString(path.join(outputDir, filePath), "utf-8")
        .pipe(Effect.orElseSucceed(() => undefined));

      if (existingContent === undefined) {
        updated.push(filePath);
      } else if (existingContent.trim() !== entry.sql.trim()) {
        updated.push(filePath);
      } else {
        unchanged.push(filePath);
      }
    }

    for (const filePath of existingPaths) {
      if (!newPaths.has(filePath)) {
        deleted.push(filePath);
      }
    }

    return { created, updated, deleted, unchanged };
  });

export function formatExportSummary(
  diff: FileDiffResult,
  dryRun: boolean,
  useColors = true,
): string {
  const lines: string[] = [];
  const verb = dryRun ? "Would" : "";
  const green = useColors ? chalk.green : identity;
  const yellow = useColors ? chalk.yellow : identity;
  const red = useColors ? chalk.red : identity;
  const dim = useColors ? chalk.dim : identity;

  if (diff.created.length > 0) {
    lines.push(
      green(
        `${verb ? `${verb} create` : "Created"}: ${diff.created.length} file(s)`,
      ),
    );
  }
  if (diff.updated.length > 0) {
    lines.push(
      yellow(
        `${verb ? `${verb} update` : "Updated"}: ${diff.updated.length} file(s)`,
      ),
    );
  }
  if (diff.deleted.length > 0) {
    lines.push(
      red(
        `${verb ? `${verb} delete` : "Deleted"}: ${diff.deleted.length} file(s)`,
      ),
    );
  }
  if (diff.unchanged.length > 0 && !dryRun) {
    lines.push(dim(`Unchanged: ${diff.unchanged.length} file(s)`));
  }

  return lines.length > 0 ? lines.join("\n") : "";
}

const identity = (value: string) => value;

export function formatFileLegend(useColors: boolean): string {
  if (!useColors) {
    return "+ created   ~ updated   - deleted";
  }
  return `${chalk.green("+")} created   ${chalk.yellow("~")} updated   ${chalk.red("-")} deleted`;
}

export function formatDryRunNotice(
  applyTip: string,
  useColors: boolean,
): { notice: string; tip: string } {
  const notice = useColors
    ? chalk.dim("\n(dry-run: no files written)")
    : "\n(dry-run: no files written)";
  const tip = useColors ? chalk.cyan(applyTip) : applyTip;
  return { notice, tip };
}
