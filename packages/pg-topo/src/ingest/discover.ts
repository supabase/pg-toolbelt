import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";

type DiscoveryResult = {
  files: string[];
  missingRoots: string[];
};

const readSqlFilesInDirectory = async (
  directoryPath: string,
  outFiles: Set<string>,
): Promise<void> => {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      await readSqlFilesInDirectory(fullPath, outFiles);
      continue;
    }

    if (entry.isFile() && fullPath.toLowerCase().endsWith(".sql")) {
      outFiles.add(path.resolve(fullPath));
    }
  }
};

export const discoverSqlFiles = async (
  roots: string[],
): Promise<DiscoveryResult> => {
  const files = new Set<string>();
  const missingRoots: string[] = [];

  for (const inputRoot of roots) {
    const resolvedRoot = path.resolve(inputRoot);
    let rootStats: Awaited<ReturnType<typeof stat>> | undefined;
    try {
      rootStats = await stat(resolvedRoot);
    } catch {
      missingRoots.push(inputRoot);
      continue;
    }

    if (rootStats.isFile() && resolvedRoot.toLowerCase().endsWith(".sql")) {
      files.add(resolvedRoot);
      continue;
    }

    if (rootStats.isDirectory()) {
      await readSqlFilesInDirectory(resolvedRoot, files);
    }
  }

  return {
    files: [...files].sort((left, right) => left.localeCompare(right)),
    missingRoots,
  };
};

// ============================================================================
// Effect-native version
// ============================================================================

const readSqlFilesInDirectoryEffect = (
  directoryPath: string,
  outFiles: Set<string>,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs
      .readDirectory(directoryPath)
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    const sortedEntries = [...entries].sort((a, b) => a.localeCompare(b));

    for (const entryName of sortedEntries) {
      const fullPath = path.join(directoryPath, entryName);
      const info = yield* fs
        .stat(fullPath)
        .pipe(Effect.orElseSucceed(() => ({ type: "File" as const })));
      if (info.type === "Directory") {
        yield* readSqlFilesInDirectoryEffect(fullPath, outFiles);
      } else if (
        info.type === "File" &&
        fullPath.toLowerCase().endsWith(".sql")
      ) {
        outFiles.add(path.resolve(fullPath));
      }
    }
  });

export const discoverSqlFilesEffect = (
  roots: string[],
): Effect.Effect<DiscoveryResult, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const files = new Set<string>();
    const missingRoots: string[] = [];

    for (const inputRoot of roots) {
      const resolvedRoot = path.resolve(inputRoot);
      const exists = yield* fs
        .exists(resolvedRoot)
        .pipe(Effect.orElseSucceed(() => false));
      if (!exists) {
        missingRoots.push(inputRoot);
        continue;
      }

      const info = yield* fs
        .stat(resolvedRoot)
        .pipe(Effect.orElseSucceed(() => ({ type: "File" as const })));
      if (info.type === "File" && resolvedRoot.toLowerCase().endsWith(".sql")) {
        files.add(resolvedRoot);
      } else if (info.type === "Directory") {
        yield* readSqlFilesInDirectoryEffect(resolvedRoot, files);
      }
    }

    return {
      files: [...files].sort((a, b) => a.localeCompare(b)),
      missingRoots,
    };
  });
