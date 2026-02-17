import { readdir, stat } from "node:fs/promises";
import path from "node:path";

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
