import { describe, expect, test } from "bun:test";
import { parsePositiveIntFlag, UsageError } from "./flags.ts";

describe("parsePositiveIntFlag", () => {
  test("absent is undefined", () => {
    expect(parsePositiveIntFlag("baseline-commit-every", undefined)).toBe(
      undefined,
    );
  });

  test("a positive integer parses", () => {
    expect(parsePositiveIntFlag("baseline-commit-every", "40")).toBe(40);
  });

  test("zero, negative, and non-integers are UsageError", () => {
    for (const raw of ["0", "-1", "1.5", "nope"]) {
      let error: unknown;
      try {
        parsePositiveIntFlag("baseline-commit-every", raw);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(UsageError);
    }
  });
});
