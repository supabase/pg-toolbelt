import { expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("dbdev fixture uses the standardized supabase-project layout", async () => {
  const projectDir = path.join(
    import.meta.dir,
    "fixtures/supabase-projects/dbdev",
  );
  const projectFile = path.join(projectDir, "project.ts");
  const migrationsDir = path.join(projectDir, "migrations");

  expect(await Bun.file(projectFile).exists()).toBe(true);
  expect((await stat(migrationsDir)).isDirectory()).toBe(true);

  const module = await import(pathToFileURL(projectFile).href);
  const fixture = module.default;
  const sqlFiles = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  expect(fixture.id).toBe("dbdev");
  expect(fixture.supabasePostgresVersion).toBe(15);
  expect(sqlFiles.length).toBeGreaterThan(0);
  expect(sqlFiles[0]).toBe("20220117141357_extensions.sql");
});
