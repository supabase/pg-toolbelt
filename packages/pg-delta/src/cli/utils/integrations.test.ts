import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadIntegrationDSL } from "./integrations.ts";

describe("loadIntegrationDSL", () => {
  test("loads from .json file path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-integration-"));
    const jsonPath = path.join(dir, "custom.json");
    try {
      await writeFile(
        jsonPath,
        JSON.stringify({
          filter: { schema: "app" },
        }),
      );
      const dsl = await loadIntegrationDSL(jsonPath);
      expect(dsl).toBeDefined();
      expect(dsl.filter).toEqual({ schema: "app" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("loads core integration by name (supabase)", async () => {
    const dsl = await loadIntegrationDSL("supabase");
    expect(dsl).toBeDefined();
    expect(dsl.filter).toBeDefined();
    expect(dsl.serialize).toBeDefined();
  });

  test("fallback to file path when core module not found", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-integration-"));
    const filePath = path.join(dir, "custom-dsl");
    await writeFile(filePath, JSON.stringify({ serialize: [] }));
    try {
      const dsl = await loadIntegrationDSL(filePath);
      expect(dsl).toEqual({ serialize: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
