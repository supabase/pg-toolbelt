import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type SqlFixtureFiles = Record<string, string>;

type TempFixtureHarness = {
  createEmptyFixture: () => Promise<string>;
  createSqlFixture: (files: SqlFixtureFiles) => Promise<string>;
  cleanup: () => Promise<void>;
};

export const createTempFixtureHarness = (
  prefix: string,
): TempFixtureHarness => {
  const tempDirectories: string[] = [];

  const createEmptyFixture = async (): Promise<string> => {
    const fixtureDirectory = await mkdtemp(path.join(os.tmpdir(), prefix));
    tempDirectories.push(fixtureDirectory);
    return fixtureDirectory;
  };

  const createSqlFixture = async (files: SqlFixtureFiles): Promise<string> => {
    const fixtureDirectory = await createEmptyFixture();

    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = path.join(fixtureDirectory, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await Bun.write(filePath, content);
    }

    return fixtureDirectory;
  };

  const cleanup = async (): Promise<void> => {
    while (tempDirectories.length > 0) {
      const directoryPath = tempDirectories.pop();
      if (!directoryPath) {
        continue;
      }
      await rm(directoryPath, { recursive: true, force: true });
    }
  };

  return {
    createEmptyFixture,
    createSqlFixture,
    cleanup,
  };
};
