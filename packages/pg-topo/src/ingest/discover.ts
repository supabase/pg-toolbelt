import path from "node:path";
import { Effect, FileSystem } from "effect";
import { WorkingDirectory } from "../services/working-directory.ts";

type DiscoveryResult = {
  files: string[];
  missingRoots: string[];
};

const resolveFromWorkingDirectory = (cwd: string, inputPath: string): string =>
  path.resolve(cwd, inputPath);

const readSqlFilesInDirectory = (
  directoryPath: string,
  outFiles: Set<string>,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const entries = yield* fs
      .readDirectory(directoryPath)
      .pipe(Effect.orElseSucceed(() => [] as string[]));
    const sortedEntries = [...entries].sort((left, right) =>
      left.localeCompare(right),
    );

    for (const entryName of sortedEntries) {
      const fullPath = path.join(directoryPath, entryName);
      const info = yield* fs
        .stat(fullPath)
        .pipe(Effect.orElseSucceed(() => ({ type: "File" as const })));
      if (info.type === "Directory") {
        yield* readSqlFilesInDirectory(fullPath, outFiles);
      } else if (
        info.type === "File" &&
        fullPath.toLowerCase().endsWith(".sql")
      ) {
        outFiles.add(path.resolve(fullPath));
      }
    }
  });

export const discoverSqlFiles = Effect.fnUntraced(function* (
  roots: string[],
) {
  const fs = yield* FileSystem.FileSystem;
  const workingDirectory = yield* WorkingDirectory;
  const files = new Set<string>();
  const missingRoots: string[] = [];

  for (const inputRoot of roots) {
    const resolvedRoot = resolveFromWorkingDirectory(
      workingDirectory.cwd,
      inputRoot,
    );
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
      yield* readSqlFilesInDirectory(resolvedRoot, files);
    }
  }

  return {
    files: [...files].sort((left, right) => left.localeCompare(right)),
    missingRoots,
  };
});
