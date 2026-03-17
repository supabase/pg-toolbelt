import { Effect, FileSystem, Path } from "effect";
import { WorkingDirectory } from "../services/working-directory.service.ts";

const resolveFromWorkingDirectory = (
  pathService: Path.Path,
  cwd: string,
  inputPath: string,
): string => pathService.resolve(cwd, inputPath);

// Recursive function — annotation required for TypeScript to infer return type
const readSqlFilesInDirectory = (
  directoryPath: string,
  outFiles: Set<string>,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
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

export const discoverSqlFiles = Effect.fnUntraced(function* (roots: string[]) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workingDirectory = yield* WorkingDirectory;
  const files = new Set<string>();
  const missingRoots: string[] = [];

  for (const inputRoot of roots) {
    const resolvedRoot = resolveFromWorkingDirectory(
      path,
      workingDirectory,
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
