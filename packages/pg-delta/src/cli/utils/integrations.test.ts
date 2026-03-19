import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FilterDSL } from "../../core/integrations/filter/dsl.ts";
import type { SerializeDSL } from "../../core/integrations/serialize/dsl.ts";
import {
  loadIntegrationDSL,
  resolveIntegrationOptions,
} from "./integrations.ts";

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

describe("extends resolution", () => {
  test('extends: "supabase" → resolves and merges successfully', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-extends-"));
    const jsonPath = path.join(dir, "custom.json");
    try {
      await writeFile(
        jsonPath,
        JSON.stringify({
          extends: "supabase",
          serialize: [
            {
              when: { objectType: "table" },
              options: { skipAuthorization: true },
            },
          ],
        }),
      );
      const dsl = await loadIntegrationDSL(jsonPath);
      expect(dsl).toBeDefined();
      // Should have the supabase filter merged in
      expect(dsl.filter).toBeDefined();
      // Should have both supabase serialize rules and our custom one
      expect(dsl.serialize).toBeDefined();
      expect(dsl.serialize?.length).toBeGreaterThan(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('extends: "./some-file.json" → throws error about core integrations only', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-extends-"));
    const filePath = path.join(dir, "child.json");
    const parentPath = path.join(dir, "parent.json");
    try {
      await writeFile(
        parentPath,
        JSON.stringify({ filter: { schema: "app" } }),
      );
      await writeFile(
        filePath,
        JSON.stringify({
          extends: parentPath,
          filter: { schema: "public" },
        }),
      );
      expect(loadIntegrationDSL(filePath)).rejects.toThrow(
        /extends only supports core integration names/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('extends: "nonexistent" → throws error about unknown core integration', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-extends-"));
    const jsonPath = path.join(dir, "custom.json");
    try {
      await writeFile(jsonPath, JSON.stringify({ extends: "nonexistent" }));
      expect(loadIntegrationDSL(jsonPath)).rejects.toThrow(
        /Unknown core integration: "nonexistent"/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveIntegrationOptions", () => {
  test("no integration, no CLI flags → all undefined", async () => {
    const result = await resolveIntegrationOptions({});
    expect(result).toEqual({
      filter: undefined,
      serialize: undefined,
    });
  });

  test("CLI flags only → passed through unchanged", async () => {
    const filter: FilterDSL = { schema: "public" };
    const serialize: SerializeDSL = [
      { when: { objectType: "schema" }, options: { skipAuthorization: true } },
    ];
    const result = await resolveIntegrationOptions({ filter, serialize });
    expect(result.filter).toEqual(filter);
    expect(result.serialize).toEqual(serialize);
    expect(result.emptyCatalog).toBeUndefined();
  });

  test("integration only → integration values returned", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-resolve-"));
    const jsonPath = path.join(dir, "int.json");
    try {
      await writeFile(
        jsonPath,
        JSON.stringify({
          filter: { schema: "app" },
          serialize: [{ when: { objectType: "table" }, options: {} }],
        }),
      );
      const result = await resolveIntegrationOptions({
        integration: jsonPath,
      });
      expect(result.filter).toEqual({ schema: "app" });
      expect(result.serialize).toEqual([
        { when: { objectType: "table" }, options: {} },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("both filter + integration filter → AND-combined", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-resolve-"));
    const jsonPath = path.join(dir, "int.json");
    try {
      await writeFile(
        jsonPath,
        JSON.stringify({
          filter: { schema: "app" },
        }),
      );
      const cliFilter: FilterDSL = { objectType: "table" };
      const result = await resolveIntegrationOptions({
        filter: cliFilter,
        integration: jsonPath,
      });
      expect(result.filter).toEqual({
        and: [{ schema: "app" }, { objectType: "table" }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("both serialize + integration serialize → concatenated (integration first)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-resolve-"));
    const jsonPath = path.join(dir, "int.json");
    try {
      const intSerialize: SerializeDSL = [
        {
          when: { objectType: "schema" },
          options: { skipAuthorization: true },
        },
      ];
      const cliSerialize: SerializeDSL = [
        { when: { objectType: "table" }, options: {} },
      ];
      await writeFile(jsonPath, JSON.stringify({ serialize: intSerialize }));
      const result = await resolveIntegrationOptions({
        serialize: cliSerialize,
        integration: jsonPath,
      });
      expect(result.serialize).toEqual([...intSerialize, ...cliSerialize]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("emptyCatalog returned from integration", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pgd-resolve-"));
    const jsonPath = path.join(dir, "int.json");
    try {
      const emptyCatalog = {
        version: 1,
        currentUser: "postgres",
        aggregates: {},
        collations: {},
        compositeTypes: {},
        domains: {},
        enums: {},
        extensions: {},
        procedures: {},
        indexes: {},
        materializedViews: {},
        subscriptions: {},
        publications: {},
        rlsPolicies: {},
        roles: {},
        schemas: {},
        sequences: {},
        tables: {},
        triggers: {},
        eventTriggers: {},
        rules: {},
        ranges: {},
        views: {},
        foreignDataWrappers: {},
        servers: {},
        userMappings: {},
        foreignTables: {},
        depends: [],
      };
      await writeFile(jsonPath, JSON.stringify({ emptyCatalog }));
      const result = await resolveIntegrationOptions({
        integration: jsonPath,
      });
      expect(result.emptyCatalog).toEqual(emptyCatalog);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
