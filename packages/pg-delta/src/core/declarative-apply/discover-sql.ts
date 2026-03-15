/**
 * Discover and read .sql files under a schema path (file or directory).
 * Matches pg-topo's discovery order for deterministic statement ordering.
 */

import { Effect, FileSystem, Path } from "effect";
import { FileDiscoveryError } from "../errors.ts";

export interface SqlFileEntry {
  /** Relative path from base (forward slashes, e.g. schemas/public/views/billing.sql) */
  filePath: string;
  /** File content */
  sql: string;
}

/**
 * Recursively collect .sql files in a directory using Effect FileSystem.
 * Entries sorted by name, then full paths sorted for deterministic order (matches pg-topo discover).
 */
const readSqlFilesInDirectory = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  directoryPath: string,
  outFiles: Set<string>,
): Effect.Effect<void, FileDiscoveryError> =>
  Effect.gen(function* () {
    const entries = yield* fs.readDirectory(directoryPath).pipe(
      Effect.mapError(
        (err) =>
          new FileDiscoveryError({
            message: `Cannot read directory '${directoryPath}': ${err.message}`,
            path: directoryPath,
          }),
      ),
    );
    const sorted = [...entries].sort((a, b) => a.localeCompare(b));

    for (const name of sorted) {
      const fullPath = path.join(directoryPath, name);
      const info = yield* fs.stat(fullPath).pipe(
        Effect.mapError(
          (err) =>
            new FileDiscoveryError({
              message: `Cannot stat '${fullPath}': ${err.message}`,
              path: fullPath,
            }),
        ),
      );

      if (info.type === "Directory") {
        yield* readSqlFilesInDirectory(fs, path, fullPath, outFiles);
        continue;
      }

      if (info.type === "File" && fullPath.toLowerCase().endsWith(".sql")) {
        outFiles.add(path.resolve(fullPath));
      }
    }
  });

/**
 * Stable relative path: path.relative(basePath, absolutePath) with forward slashes.
 */
function toStablePath(
  path: Path.Path,
  absolutePath: string,
  basePath: string,
): string {
  return path.relative(basePath, absolutePath).split(path.sep).join("/");
}

/**
 * Load all .sql files under schemaPath (a single .sql file or a directory).
 * Returns entries in the same order as pg-topo's discover (sorted by full path).
 */
export const loadDeclarativeSchema = (
  schemaPath: string,
): Effect.Effect<
  SqlFileEntry[],
  FileDiscoveryError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const resolvedRoot = path.resolve(schemaPath);

    const rootStat = yield* fs.stat(resolvedRoot).pipe(
      Effect.mapError(
        (err) =>
          new FileDiscoveryError({
            message: `Cannot access '${schemaPath}': ${err.message}`,
            path: schemaPath,
          }),
      ),
    );

    let files: string[];
    let basePath: string;

    if (rootStat.type === "File") {
      if (!resolvedRoot.toLowerCase().endsWith(".sql")) {
        return yield* Effect.fail(
          new FileDiscoveryError({
            message: `Path is not a .sql file: '${schemaPath}'`,
            path: schemaPath,
          }),
        );
      }
      files = [resolvedRoot];
      basePath = path.dirname(resolvedRoot);
    } else if (rootStat.type === "Directory") {
      const fileSet = new Set<string>();
      yield* readSqlFilesInDirectory(fs, path, resolvedRoot, fileSet);
      files = [...fileSet].sort((a, b) => a.localeCompare(b));
      basePath = resolvedRoot;
    } else {
      return yield* Effect.fail(
        new FileDiscoveryError({
          message: `Path is not a file or directory: '${schemaPath}'`,
          path: schemaPath,
        }),
      );
    }

    const entries: SqlFileEntry[] = [];
    for (const filePath of files) {
      const sql = yield* fs.readFileString(filePath).pipe(
        Effect.mapError((err) => {
          const relative = toStablePath(path, filePath, basePath);
          return new FileDiscoveryError({
            message: `Cannot read file '${relative}': ${err.message}`,
            path: relative,
          });
        }),
      );
      entries.push({
        filePath: toStablePath(path, filePath, basePath),
        sql,
      });
    }

    return entries;
  });
