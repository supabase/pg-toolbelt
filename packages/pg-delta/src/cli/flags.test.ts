import { describe, expect, test } from "bun:test";
import {
  parseLockSplitFlags,
  parsePositiveIntFlag,
  restrictToApplierFromFlags,
  UsageError,
} from "./flags.ts";

describe("parsePositiveIntFlag", () => {
  test("absent is undefined", () => {
    expect(parsePositiveIntFlag("max-locks", undefined)).toBe(undefined);
  });

  test("a positive integer parses", () => {
    expect(parsePositiveIntFlag("max-locks", "40")).toBe(40);
  });

  test("zero, negative, and non-integers are UsageError", () => {
    for (const raw of ["0", "-1", "1.5", "nope"]) {
      let error: unknown;
      try {
        parsePositiveIntFlag("max-locks", raw);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(UsageError);
    }
  });
});

describe("parseLockSplitFlags", () => {
  test("rejects both --max-locks and --split-to-fit", () => {
    let error: unknown;
    try {
      parseLockSplitFlags({ "max-locks": "40", "split-to-fit": true });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(UsageError);
  });
});

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
