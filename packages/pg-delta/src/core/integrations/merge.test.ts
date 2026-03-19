import { describe, expect, test } from "bun:test";
import type { IntegrationDSL } from "./integration-dsl.ts";
import { mergeIntegrations } from "./merge.ts";

describe("mergeIntegrations", () => {
  test("empty list returns empty object", () => {
    expect(mergeIntegrations([])).toEqual({});
  });

  test("single integration is returned as-is", () => {
    const integration: IntegrationDSL = {
      filter: { objectType: "table" },
      serialize: [
        {
          when: { objectType: "schema" },
          options: { skipAuthorization: true },
        },
      ],
    };
    expect(mergeIntegrations([integration])).toBe(integration);
  });

  test("filters are AND-combined", () => {
    const base: IntegrationDSL = {
      filter: { "*/schema": "public" },
    };
    const ext: IntegrationDSL = {
      filter: { objectType: "table" },
    };

    const merged = mergeIntegrations([base, ext]);
    expect(merged.filter).toEqual({
      and: [{ "*/schema": "public" }, { objectType: "table" }],
    });
  });

  test("single filter is not wrapped in and", () => {
    const base: IntegrationDSL = {};
    const ext: IntegrationDSL = {
      filter: { objectType: "table" },
    };

    const merged = mergeIntegrations([base, ext]);
    expect(merged.filter).toEqual({ objectType: "table" });
  });

  test("serialize rules are concatenated (base first)", () => {
    const base: IntegrationDSL = {
      serialize: [
        {
          when: { objectType: "schema" },
          options: { skipAuthorization: true },
        },
      ],
    };
    const ext: IntegrationDSL = {
      serialize: [
        {
          when: { objectType: "table" },
          options: { skipAuthorization: false },
        },
      ],
    };

    const merged = mergeIntegrations([base, ext]);
    expect(merged.serialize).toEqual([
      { when: { objectType: "schema" }, options: { skipAuthorization: true } },
      { when: { objectType: "table" }, options: { skipAuthorization: false } },
    ]);
  });

  test("emptyCatalog: most-specific (last) wins", () => {
    const baseCatalog = {
      version: 15,
      schemas: {},
    } as IntegrationDSL["emptyCatalog"];
    const extCatalog = {
      version: 16,
      schemas: {},
    } as IntegrationDSL["emptyCatalog"];

    const base: IntegrationDSL = { emptyCatalog: baseCatalog };
    const ext: IntegrationDSL = { emptyCatalog: extCatalog };

    const merged = mergeIntegrations([base, ext]);
    expect(merged.emptyCatalog).toBe(extCatalog);
  });

  test("emptyCatalog: falls back to base if most-specific is undefined", () => {
    const baseCatalog = {
      version: 15,
      schemas: {},
    } as IntegrationDSL["emptyCatalog"];

    const base: IntegrationDSL = { emptyCatalog: baseCatalog };
    const ext: IntegrationDSL = {};

    const merged = mergeIntegrations([base, ext]);
    expect(merged.emptyCatalog).toBe(baseCatalog);
  });

  test("full merge combines all fields", () => {
    const base: IntegrationDSL = {
      filter: { "*/schema": "public" },
      serialize: [
        {
          when: { objectType: "schema" },
          options: { skipAuthorization: true },
        },
      ],
    };
    const ext: IntegrationDSL = {
      filter: { not: { objectType: "role" } },
      serialize: [
        {
          when: { objectType: "table" },
          options: { skipAuthorization: false },
        },
      ],
    };

    const merged = mergeIntegrations([base, ext]);
    expect(merged.filter).toEqual({
      and: [{ "*/schema": "public" }, { not: { objectType: "role" } }],
    });
    expect(merged.serialize).toHaveLength(2);
  });
});
