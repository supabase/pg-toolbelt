import { describe, expect, test } from "vitest";

describe.concurrent("index", () => {
  describe("alter", () => {
    test("set storage params", () => {
      expect(1).toBe(1);
    });

    test("reset and set storage params", () => {
      expect(1).toBe(1);
    });

    test("set statistics", () => {
      expect(1).toBe(1);
    });

    test("set tablespace", () => {
      expect(1).toBe(1);
    });

    test("replace index (drop + create)", () => {
      expect(1).toBe(1);
    });
  });
});
