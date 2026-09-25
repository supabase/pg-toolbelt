import { describe, expect, test } from "bun:test";
import {
  assertActionSqlBatchable,
  encodeBatch,
  failedBatchIndex,
  joinStatements,
  partitionByBatchBounds,
} from "./batch-query.ts";

describe("assertActionSqlBatchable", () => {
  test("rejects empty and transaction-control text", () => {
    expect(() => assertActionSqlBatchable("")).toThrow(/empty/);
    expect(() => assertActionSqlBatchable("   ")).toThrow(/empty/);
    expect(() => assertActionSqlBatchable("BEGIN")).toThrow(
      /transaction control/,
    );
    expect(() => assertActionSqlBatchable("commit;")).toThrow(
      /transaction control/,
    );
    expect(() => assertActionSqlBatchable("ROLLBACK TO save")).toThrow(
      /transaction control/,
    );
    expect(() => assertActionSqlBatchable(";;;")).toThrow(/empty/);
  });

  test("accepts ordinary DDL", () => {
    expect(() =>
      assertActionSqlBatchable("CREATE TABLE app.t (id int)"),
    ).not.toThrow();
  });
});

describe("partitionByBatchBounds", () => {
  test("keeps a small segment in one batch", () => {
    expect(
      partitionByBatchBounds(["BEGIN", "SELECT 1", "SELECT 2"], (s) => s),
    ).toEqual([["BEGIN", "SELECT 1", "SELECT 2"]]);
  });

  test("splits at the statement cap", () => {
    const items = Array.from({ length: 3 }, (_, i) => `S${String(i)}`);
    expect(
      partitionByBatchBounds(items, (s) => s, { maxStatements: 2 }),
    ).toEqual([["S0", "S1"], ["S2"]]);
  });

  test("splits when the next statement would exceed the byte cap", () => {
    // terminated "aa" is "aa\n;" (4 bytes); two of those plus "\n\n" is 10.
    expect(
      partitionByBatchBounds(["aa", "bb", "cc"], (s) => s, {
        maxBytes: 10,
      }),
    ).toEqual([["aa", "bb"], ["cc"]]);
  });

  test("a single oversized statement is still its own batch", () => {
    expect(
      partitionByBatchBounds(["abcdefghij"], (s) => s, { maxBytes: 3 }),
    ).toEqual([["abcdefghij"]]);
  });

  test("the byte cap is UTF-8, not UTF-16 code units", () => {
    // "中\n;" is 5 UTF-8 bytes; two joined are 12. A 4-byte cap splits.
    expect(
      partitionByBatchBounds(["中", "中"], (s) => s, { maxBytes: 4 }),
    ).toEqual([["中"], ["中"]]);
  });
});

describe("joinStatements", () => {
  test("puts the semicolon on its own line", () => {
    expect(joinStatements(["BEGIN", "SELECT 1"])).toBe(
      "BEGIN\n;\n\nSELECT 1\n;",
    );
  });

  test("strips a trailing semicolon so join does not emit an empty query", () => {
    expect(joinStatements(["BEGIN", "SELECT 1;"])).toBe(
      "BEGIN\n;\n\nSELECT 1\n;",
    );
  });

  test("a trailing line comment cannot swallow the separator", () => {
    expect(joinStatements(["SELECT 1 -- leftover", "SELECT 2"])).toBe(
      "SELECT 1 -- leftover\n;\n\nSELECT 2\n;",
    );
  });
});

describe("failedBatchIndex", () => {
  const encoded = encodeBatch(["BEGIN", "SELECT 1", "SELCT 1"]);

  test("a parse-time position maps to the slot that contains it", () => {
    const pos = encoded.text.indexOf("SELCT") + 1;
    expect(
      failedBatchIndex(
        3,
        { completedBeforeError: 0, position: String(pos) },
        encoded.ranges,
      ),
    ).toBe(2);
  });

  test("zero completions without a position name the first slot", () => {
    expect(
      failedBatchIndex(3, { completedBeforeError: 0 }, encoded.ranges),
    ).toBe(0);
  });

  test("a mid-batch completion count is the failing slot", () => {
    expect(
      failedBatchIndex(3, { completedBeforeError: 1 }, encoded.ranges),
    ).toBe(1);
  });

  test("completions past the last slot walk off the end", () => {
    expect(
      failedBatchIndex(3, { completedBeforeError: 3 }, encoded.ranges),
    ).toBe(3);
  });

  test("a present position wins over a shifted CommandComplete count", () => {
    const multi = encodeBatch([
      "BEGIN",
      "REVOKE ALL ON SCHEMA s FROM PUBLIC;\nGRANT USAGE ON SCHEMA s TO PUBLIC",
      "CREATE TABLE s.t (id int)",
    ]);
    const pos = multi.text.indexOf("GRANT") + 1;
    expect(
      failedBatchIndex(
        3,
        { completedBeforeError: 2, position: String(pos) },
        multi.ranges,
      ),
    ).toBe(1);
  });

  test("position mapping counts Postgres characters, not UTF-16 units", () => {
    const withEmoji = encodeBatch(["😀".repeat(10), "SELCT 1"]);
    expect(withEmoji.text.indexOf("SELCT") + 1).not.toBe(
      withEmoji.ranges[1]!.start + 1,
    );
    expect(
      failedBatchIndex(
        2,
        {
          completedBeforeError: 0,
          position: String(withEmoji.ranges[1]!.start + 1),
        },
        withEmoji.ranges,
      ),
    ).toBe(1);
  });
});
