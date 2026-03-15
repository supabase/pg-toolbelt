import { readFile, readdir, stat } from "node:fs/promises";
import { Effect, FileSystem, Layer } from "effect";

export const nodeFileSystemLayer = Layer.succeed(
  FileSystem.FileSystem,
  {
    exists: (filePath: string) =>
      Effect.promise(async () => {
        try {
          await stat(filePath);
          return true;
        } catch {
          return false;
        }
      }),
    stat: (filePath: string) =>
      Effect.tryPromise({
        try: async () => {
          const info = await stat(filePath);
          return info.isDirectory()
            ? ({ type: "Directory" } as const)
            : ({ type: "File" } as const);
        },
        catch: (error) => error,
      }),
    readDirectory: (directoryPath: string) =>
      Effect.tryPromise({
        try: () => readdir(directoryPath),
        catch: (error) => error,
      }),
    readFileString: (filePath: string, _encoding: string) =>
      Effect.tryPromise({
        try: () => readFile(filePath, "utf-8"),
        catch: (error) => error,
      }),
  } as never,
);
