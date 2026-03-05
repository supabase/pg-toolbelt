import { describe, expect, test } from "bun:test";
import path from "node:path";
import { isPostgresUrl, loadCatalogFromFile } from "./resolve-input.ts";

describe("isPostgresUrl", () => {
  test("returns true for postgres:// URL", () => {
    expect(isPostgresUrl("postgres://user:pass@localhost:5432/db")).toBe(true);
  });

  test("returns true for postgresql:// URL", () => {
    expect(isPostgresUrl("postgresql://localhost/db")).toBe(true);
  });

  test("returns false for file path", () => {
    expect(isPostgresUrl("/path/to/catalog.json")).toBe(false);
    expect(isPostgresUrl("catalog.json")).toBe(false);
  });

  test("returns false for other strings", () => {
    expect(isPostgresUrl("")).toBe(false);
    expect(isPostgresUrl("postgres")).toBe(false);
  });
});

describe("loadCatalogFromFile", () => {
  test("loads and deserializes catalog from JSON file", async () => {
    const fixturePath = path.join(
      import.meta.dir,
      "../../core/fixtures/empty-catalogs/postgres-15-16-baseline.json",
    );
    const catalog = await loadCatalogFromFile(fixturePath);
    expect(catalog).toBeDefined();
    expect(catalog.version).toBeGreaterThan(0);
    expect(typeof catalog.currentUser).toBe("string");
    expect(catalog.schemas).toBeDefined();
    expect(catalog.depends).toEqual(expect.any(Array));
  });
});
