import { describe, expect, test } from "bun:test";
import {
  parseLockSplitFlags,
  parsePositiveIntFlag,
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
