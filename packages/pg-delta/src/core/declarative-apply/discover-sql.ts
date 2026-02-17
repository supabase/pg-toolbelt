/**
 * Discover and read .sql files under a schema path (file or directory).
 * Matches pg-topo's discovery order for deterministic statement ordering.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface SqlFileEntry {
  /** Relative path from base (forward slashes, e.g. schemas/public/views/billing.sql) */
  filePath: string;
  /** File content */
  sql: string;
}

/**
 * Recursively collect .sql files in a directory. Entries sorted by name,
 * then full paths sorted for deterministic order (matches pg-topo discover).
 */
async function readSqlFilesInDirectory(
  directoryPath: string,
  outFiles: Set<string>,
): Promise<void> {
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
}

/**
 * Stable relative path: path.relative(basePath, absolutePath) with forward slashes.
 */
function toStablePath(absolutePath: string, basePath: string): string {
  return path.relative(basePath, absolutePath).split(path.sep).join("/");
}

/**
 * Load all .sql files under schemaPath (a single .sql file or a directory).
 * Returns entries in the same order as pg-topo's discover (sorted by full path).
 *
 * @throws If schemaPath does not exist, is not a file/directory, or any file cannot be read.
 *         Error message includes path and code (e.g. ENOENT, EACCES) for CLI to display.
 */
export async function loadDeclarativeSchema(
  schemaPath: string,
): Promise<SqlFileEntry[]> {
  const resolvedRoot = path.resolve(schemaPath);

  let rootStats: Awaited<ReturnType<typeof stat>>;
  try {
    rootStats = await stat(resolvedRoot);
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as NodeJS.ErrnoException).code)
        : "UNKNOWN";
    throw new Error(`Cannot access '${schemaPath}': ${code}`);
  }

  let files: string[];
  let basePath: string;

  if (rootStats.isFile()) {
    if (!resolvedRoot.toLowerCase().endsWith(".sql")) {
      throw new Error(`Path is not a .sql file: '${schemaPath}'`);
    }
    files = [resolvedRoot];
    basePath = path.dirname(resolvedRoot);
  } else if (rootStats.isDirectory()) {
    const fileSet = new Set<string>();
    await readSqlFilesInDirectory(resolvedRoot, fileSet);
    files = [...fileSet].sort((a, b) => a.localeCompare(b));
    basePath = resolvedRoot;
  } else {
    throw new Error(`Path is not a file or directory: '${schemaPath}'`);
  }

  const entries: SqlFileEntry[] = [];
  for (const filePath of files) {
    try {
      const sql = await readFile(filePath, "utf-8");
      entries.push({
        filePath: toStablePath(filePath, basePath),
        sql,
      });
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as NodeJS.ErrnoException).code)
          : "UNKNOWN";
      const relative = toStablePath(filePath, basePath);
      throw new Error(`Cannot read file '${relative}': ${code}`);
    }
  }

  return entries;
}
