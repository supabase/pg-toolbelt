import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadDeclarativeSchema } from "./discover-sql.ts";

describe("loadDeclarativeSchema", () => {
  it("throws when path does not exist", async () => {
    const nonExistent = path.join(tmpdir(), `pgdelta-nonexistent-${Date.now()}`);

    await expect(loadDeclarativeSchema(nonExistent)).rejects.toThrow(
      /Cannot access.*ENOENT/,
    );
  });

  it("throws when path is a file but not .sql", async () => {
    const dir = path.join(
      tmpdir(),
      `pgdelta-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(dir, { recursive: true });
    const txtFile = path.join(dir, "foo.txt");
    await writeFile(txtFile, "not sql");

    try {
      await expect(loadDeclarativeSchema(txtFile)).rejects.toThrow(
        /Path is not a \.sql file/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads a single .sql file and returns one entry with relative path", async () => {
    const dir = path.join(
      tmpdir(),
      `pgdelta-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(dir, { recursive: true });
    const sqlFile = path.join(dir, "schema.sql");
    const content = "CREATE SCHEMA foo;";
    await writeFile(sqlFile, content);

    try {
      const entries = await loadDeclarativeSchema(sqlFile);
      expect(entries).toHaveLength(1);
      expect(entries[0].filePath).toBe("schema.sql");
      expect(entries[0].sql).toBe(content);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads directory of .sql files in deterministic order (match pg-topo)", async () => {
    const dir = path.join(
      tmpdir(),
      `pgdelta-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(dir, { recursive: true });
    const clusterDir = path.join(dir, "cluster");
    const subDir = path.join(dir, "schemas", "public");
    await mkdir(clusterDir, { recursive: true });
    await mkdir(subDir, { recursive: true });
    await writeFile(path.join(clusterDir, "roles.sql"), "SELECT 1;");
    await writeFile(path.join(subDir, "schema.sql"), "CREATE SCHEMA public;");
    await writeFile(path.join(subDir, "tables.sql"), "CREATE TABLE t (id int);");

    try {
      const entries = await loadDeclarativeSchema(dir);
      expect(entries.length).toBeGreaterThanOrEqual(3);
      const paths = entries.map((e) => e.filePath);
      const sorted = [...paths].sort((a, b) => a.localeCompare(b));
      expect(paths).toEqual(sorted);
      expect(paths).toContain("schemas/public/schema.sql");
      expect(paths).toContain("schemas/public/tables.sql");
      expect(paths).toContain("cluster/roles.sql");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns empty array when directory has no .sql files", async () => {
    const dir = path.join(
      tmpdir(),
      `pgdelta-discover-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "readme.txt"), "no sql here");

    try {
      const entries = await loadDeclarativeSchema(dir);
      expect(entries).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
