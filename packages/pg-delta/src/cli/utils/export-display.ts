/**
 * CLI helpers for declarative export: file tree, diff, and summary formatting.
 */

import { Data, Effect, FileSystem, Path } from "effect";
import type { FileEntry } from "../../core/export/types.ts";
import { createAnsiPalette, maybeColorize } from "../ansi.ts";

export class ExportPathTraversalError extends Data.TaggedError(
  "ExportPathTraversalError",
)<{
  readonly filePath: string;
  readonly outputDir: string;
  readonly resolvedOutput: string;
  readonly resolvedFile: string;
  readonly message: string;
}> {}

/**
 * Ensure a relative file path does not escape the output directory.
 * Uses Effect Path.resolve + startsWith as the canonical traversal check.
 */
export const assertSafePath = Effect.fn("assertSafePath")(function* (
  path: Path.Path,
  filePath: string,
  outputDir: string,
) {
  const resolvedOutput = path.resolve(outputDir);
  const resolvedFile = path.resolve(outputDir, filePath);
  if (
    resolvedFile !== resolvedOutput &&
    !resolvedFile.startsWith(resolvedOutput + path.sep)
  ) {
    return yield* Effect.fail(
      new ExportPathTraversalError({
        filePath,
        outputDir,
        resolvedOutput,
        resolvedFile,
        message: `Export path traversal detected: '${filePath}' resolves outside output directory`,
      }),
    );
  }
});

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
  const palette = createAnsiPalette(useColors);
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
      return palette.green(`+ ${segment}`);
    case "updated":
      return palette.yellow(`~ ${segment}`);
    case "deleted":
      return palette.red(`- ${segment}`);
    default:
      return palette.dim(segment);
  }
}

const basenameFromPath = (value: string): string => {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1) ?? value;
};

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
      return useColors
        ? createAnsiPalette(true).dim("(no file changes)")
        : "(no file changes)";
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
    const segment = relPath ? basenameFromPath(relPath) : outputDir;
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
        basenameFromPath(a).localeCompare(basenameFromPath(b)),
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
): Effect.Effect<string[], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
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

export const computeFileDiff = (outputDir: string, newFiles: FileEntry[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
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
) {
  const lines: string[] = [];
  const verb = dryRun ? "Would" : "";
  const palette = createAnsiPalette(useColors);
  const green = maybeColorize(useColors, palette.green);
  const yellow = maybeColorize(useColors, palette.yellow);
  const red = maybeColorize(useColors, palette.red);
  const dim = maybeColorize(useColors, palette.dim);

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

export function formatFileLegend(useColors: boolean) {
  if (!useColors) {
    return "+ created   ~ updated   - deleted";
  }
  const palette = createAnsiPalette(true);
  return `${palette.green("+")} created   ${palette.yellow("~")} updated   ${palette.red("-")} deleted`;
}

export function formatDryRunNotice(applyTip: string, useColors: boolean) {
  const palette = createAnsiPalette(useColors);
  const notice = useColors
    ? palette.dim("\n(dry-run: no files written)")
    : "\n(dry-run: no files written)";
  const tip = useColors ? palette.cyan(applyTip) : applyTip;
  return { notice, tip };
}
