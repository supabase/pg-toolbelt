import { describe, expect, test } from "bun:test";
import { restrictToApplierFromFlags, UsageError } from "./flags.ts";

describe("restrictToApplierFromFlags", () => {
  test("omitted flags leave resolveProfile on its default probe", () => {
    expect(
      restrictToApplierFromFlags({
        "restrict-to-applier": false,
        "no-restrict-to-applier": false,
      }),
    ).toBeUndefined();
  });

  test("--restrict-to-applier is explicit true", () => {
    expect(
      restrictToApplierFromFlags({
        "restrict-to-applier": true,
        "no-restrict-to-applier": false,
      }),
    ).toBe(true);
  });

  test("--no-restrict-to-applier is the unrestricted hatch", () => {
    expect(
      restrictToApplierFromFlags({
        "restrict-to-applier": false,
        "no-restrict-to-applier": true,
      }),
    ).toBe(false);
  });

  test("both flags are a usage error", () => {
    expect(() =>
      restrictToApplierFromFlags({
        "restrict-to-applier": true,
        "no-restrict-to-applier": true,
      }),
    ).toThrow(UsageError);
  });
});
