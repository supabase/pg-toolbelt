import { afterEach, describe, expect, test } from "bun:test";
import {
  extractWithDefinitionRetry,
  resolveExtractRetries,
} from "./extract-with-retry.ts";

type Row = { id: string; definition: string | null };

const hasNullDefinition = (r: Row) => r.definition === null;

describe("resolveExtractRetries", () => {
  const originalEnv = process.env.PGDELTA_EXTRACT_RETRIES;
  afterEach(() => {
    if (originalEnv === undefined) {
      process.env.PGDELTA_EXTRACT_RETRIES = undefined;
      delete process.env.PGDELTA_EXTRACT_RETRIES;
    } else {
      process.env.PGDELTA_EXTRACT_RETRIES = originalEnv;
    }
  });

  test("defaults to 2 when option and env are unset", () => {
    delete process.env.PGDELTA_EXTRACT_RETRIES;
    expect(resolveExtractRetries()).toBe(2);
  });

  test("uses option when provided", () => {
    process.env.PGDELTA_EXTRACT_RETRIES = "5";
    expect(resolveExtractRetries(0)).toBe(0);
    expect(resolveExtractRetries(1)).toBe(1);
    expect(resolveExtractRetries(7)).toBe(7);
  });

  test("falls back to env when option is undefined", () => {
    process.env.PGDELTA_EXTRACT_RETRIES = "4";
    expect(resolveExtractRetries()).toBe(4);
  });

  test("clamps negative values to 0", () => {
    delete process.env.PGDELTA_EXTRACT_RETRIES;
    expect(resolveExtractRetries(-3)).toBe(0);
    process.env.PGDELTA_EXTRACT_RETRIES = "-9";
    expect(resolveExtractRetries()).toBe(0);
  });

  test("ignores non-numeric env values", () => {
    process.env.PGDELTA_EXTRACT_RETRIES = "not-a-number";
    expect(resolveExtractRetries()).toBe(2);
  });

  test("ignores empty env string", () => {
    process.env.PGDELTA_EXTRACT_RETRIES = "";
    expect(resolveExtractRetries()).toBe(2);
  });
});

describe("extractWithDefinitionRetry", () => {
  test("returns first attempt when no row has null definition", async () => {
    let attempts = 0;
    const rows = await extractWithDefinitionRetry<Row>({
      label: "test",
      query: async () => {
        attempts++;
        return [{ id: "a", definition: "OK" }];
      },
      hasNullDefinition,
      options: { retries: 2, backoffMs: 0 },
    });
    expect(attempts).toBe(1);
    expect(rows).toEqual([{ id: "a", definition: "OK" }]);
  });

  test("retries when definition is null and succeeds on attempt 2", async () => {
    let attempts = 0;
    const rows = await extractWithDefinitionRetry<Row>({
      label: "test",
      query: async () => {
        attempts++;
        if (attempts === 1) {
          return [
            { id: "a", definition: "OK" },
            { id: "b", definition: null },
          ];
        }
        return [{ id: "a", definition: "OK" }];
      },
      hasNullDefinition,
      options: { retries: 2, backoffMs: 0 },
    });
    expect(attempts).toBe(2);
    expect(rows).toEqual([{ id: "a", definition: "OK" }]);
  });

  test("returns last-attempt rows (with offenders) once retries are exhausted", async () => {
    let attempts = 0;
    const rows = await extractWithDefinitionRetry<Row>({
      label: "test",
      query: async () => {
        attempts++;
        return [
          { id: "a", definition: "OK" },
          { id: "b", definition: null },
        ];
      },
      hasNullDefinition,
      options: { retries: 2, backoffMs: 0 },
    });
    expect(attempts).toBe(3);
    expect(rows).toEqual([
      { id: "a", definition: "OK" },
      { id: "b", definition: null },
    ]);
  });

  test("retries: 0 disables retrying entirely", async () => {
    let attempts = 0;
    const rows = await extractWithDefinitionRetry<Row>({
      label: "test",
      query: async () => {
        attempts++;
        return [{ id: "b", definition: null }];
      },
      hasNullDefinition,
      options: { retries: 0, backoffMs: 0 },
    });
    expect(attempts).toBe(1);
    expect(rows).toEqual([{ id: "b", definition: null }]);
  });

  test("retries: 5 attempts up to 6 times before giving up", async () => {
    let attempts = 0;
    await extractWithDefinitionRetry<Row>({
      label: "test",
      query: async () => {
        attempts++;
        return [{ id: "b", definition: null }];
      },
      hasNullDefinition,
      options: { retries: 5, backoffMs: 0 },
    });
    expect(attempts).toBe(6);
  });
});
