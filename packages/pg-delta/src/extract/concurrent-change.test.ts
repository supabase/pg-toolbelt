import { describe, expect, test } from "bun:test";
import { deparsedDef, isConcurrentCatalogChange } from "./scope.ts";

const pgError = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

describe("isConcurrentCatalogChange", () => {
  test.each([
    "cache lookup failed for attribute 1 of relation 17542",
    "cache lookup failed for index 16397",
    "cache lookup failed for relation 43629",
    "could not open relation with OID 43629",
  ])("retries XX000 %p", (message) => {
    expect(isConcurrentCatalogChange(pgError("XX000", message))).toBe(true);
  });

  test("does not retry other failures", () => {
    expect(
      isConcurrentCatalogChange(pgError("XX000", "unexpected chunk number")),
    ).toBe(false);
    expect(
      isConcurrentCatalogChange(pgError("42P01", "cache lookup failed for x")),
    ).toBe(false);
    expect(isConcurrentCatalogChange(new Error("boom"))).toBe(false);
    expect(isConcurrentCatalogChange(undefined)).toBe(false);
  });

  test("a NULL deparse result is a concurrent change", () => {
    let thrown: unknown;
    try {
      deparsedDef({ schema: "app", name: "t_idx", def: null }, "index");
    } catch (error) {
      thrown = error;
    }
    expect(isConcurrentCatalogChange(thrown)).toBe(true);
    expect((thrown as Error).message).toBe(
      "index app.t_idx was dropped during extraction",
    );
  });
});
